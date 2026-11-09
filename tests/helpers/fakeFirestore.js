/**
 * Firestore en mémoire pour les tests : juste ce qu'utilisent les services (documents, sous-collections, where/orderBy/
 * limit/startAfter/count, getAll, transactions, FieldValue.increment, chemins pointés dans update()).
 * Reproduit volontairement des contraintes réelles qui attrapent de vrais bugs : `undefined` interdit, `create()` refuse
 * un id existant (code 6), `update()` refuse un document absent (code 5), lecture après écriture interdite en transaction.
 * `db.simulateMissingIndex = true` : toute requête filtrée + triée échoue comme sans index composite (code 9).
 */
const path = require('node:path');

const FieldValue = { increment: (n) => ({ __op: 'increment', n }) };
const FieldPath = { documentId: () => '__name__' };

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const assertDefined = (v, where = '') => {
  if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value${where ? ` (found in field "${where}")` : ''}.`);
  if (v && typeof v === 'object' && !v.__op) for (const [k, x] of Object.entries(v)) assertDefined(x, where ? `${where}.${k}` : k);
};

const getIn = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const setIn = (obj, dotted, value) => {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  o[last] = value && value.__op === 'increment' ? (Number(o[last]) || 0) + value.n : clone(value);
};

const err = (code, message) => Object.assign(new Error(message), { code });

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Snap {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
  data() { return this.exists ? clone(this._data) : undefined; }
}

class DocRef {
  constructor(db, p) { this.db = db; this.path = p; this.id = p.split('/').pop(); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  async get() { return new Snap(this, this.db.store.get(this.path)); }
  async set(data, opts = {}) { this.db._set(this.path, data, opts); }
  async update(data) { this.db._update(this.path, data); }
  async create(data) { this.db._create(this.path, data); }
  async delete() { this.db.store.delete(this.path); }
}

class Query {
  constructor(db, colPath, { filters = [], orders = [], lim = null, start = null } = {}) {
    this.db = db; this.colPath = colPath; this.filters = filters; this.orders = orders; this.lim = lim; this.start = start;
    this.id = colPath.split('/').pop();
  }

  _with(patch) { return new Query(this.db, this.colPath, { filters: this.filters, orders: this.orders, lim: this.lim, start: this.start, ...patch }); }
  doc(id) { return new DocRef(this.db, `${this.colPath}/${id || this.db._autoId()}`); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
  where(field, op, value) { return this._with({ filters: [...this.filters, { field, op, value }] }); }
  orderBy(field, dir = 'asc') { return this._with({ orders: [...this.orders, { field, dir }] }); }
  limit(n) { return this._with({ lim: n }); }
  startAfter(...values) { return this._with({ start: values }); }

  _valueOf(id, data, field) { return field === '__name__' ? id : getIn(data, field); }

  _match(id, data) {
    return this.filters.every(({ field, op, value }) => {
      const v = this._valueOf(id, data, field);
      switch (op) {
        case '==': return v === value;
        case 'in': return value.includes(v);
        case '>=': return v !== undefined && v >= value;
        case '>': return v !== undefined && v > value;
        case '<=': return v !== undefined && v <= value;
        case '<': return v !== undefined && v < value;
        case 'array-contains': return Array.isArray(v) && v.includes(value);
        default: throw new Error(`Opérateur non géré par le faux Firestore : ${op}`);
      }
    });
  }

  _run() {
    if (this.db.simulateMissingIndex && this.orders.length && this.filters.length) {
      throw err(9, '9 FAILED_PRECONDITION: The query requires an index.');
    }
    const prefix = `${this.colPath}/`;
    let rows = [];
    for (const [p, data] of this.db.store) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
      const id = p.slice(prefix.length);
      if (this._match(id, data)) rows.push({ id, data });
    }
    const orders = this.orders.length ? this.orders : [{ field: '__name__', dir: 'asc' }];
    rows = rows.filter((r) => orders.every((o) => this._valueOf(r.id, r.data, o.field) !== undefined));
    rows.sort((a, b) => {
      for (const o of orders) {
        const c = cmp(this._valueOf(a.id, a.data, o.field), this._valueOf(b.id, b.data, o.field));
        if (c) return o.dir === 'desc' ? -c : c;
      }
      return 0;
    });
    if (this.start !== null) {
      rows = rows.filter((r) => {
        for (let i = 0; i < this.start.length; i += 1) {
          const c = cmp(this._valueOf(r.id, r.data, orders[i].field), this.start[i]);
          if (c) return orders[i].dir === 'desc' ? c < 0 : c > 0;
        }
        return false; // égal au curseur : exclu (startAfter)
      });
    }
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    return rows;
  }

  async get() {
    const docs = this._run().map(({ id, data }) => new Snap(new DocRef(this.db, `${this.colPath}/${id}`), data));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  count() { return { get: async () => ({ data: () => ({ count: this._run().length }) }) }; }
}

class Transaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(target) {
    if (this.writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
    return target.get();
  }
  set(ref, data, opts) { this.writes.push(() => this.db._set(ref.path, data, opts || {})); return this; }
  update(ref, data) { this.writes.push(() => this.db._update(ref.path, data)); return this; }
  create(ref, data) { this.writes.push(() => this.db._create(ref.path, data)); return this; }
  delete(ref) { this.writes.push(() => this.db.store.delete(ref.path)); return this; }
}

class FakeDb {
  constructor() { this.store = new Map(); this.simulateMissingIndex = false; this._n = 0; }
  reset() { this.store.clear(); this.simulateMissingIndex = false; }
  _autoId() { this._n += 1; return `auto${String(this._n).padStart(6, '0')}`; }
  collection(name) { return new Query(this, name); }
  async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); }
  async runTransaction(fn) {
    const tx = new Transaction(this);
    const result = await fn(tx);
    tx.writes.forEach((w) => w());
    return result;
  }

  _set(p, data, { merge = false } = {}) {
    assertDefined(data);
    if (!merge) { this.store.set(p, clone(data)); return; }
    const next = this.store.get(p) || {};
    for (const [k, v] of Object.entries(data)) setIn(next, k, v);
    this.store.set(p, next);
  }

  _update(p, data) {
    assertDefined(data);
    const current = this.store.get(p);
    if (current === undefined) throw err(5, `5 NOT_FOUND: No document to update: ${p}`);
    const next = clone(current);
    for (const [k, v] of Object.entries(data)) setIn(next, k, v);
    this.store.set(p, next);
  }

  _create(p, data) {
    assertDefined(data);
    if (this.store.has(p)) throw err(6, `6 ALREADY_EXISTS: Document already exists: ${p}`);
    this.store.set(p, clone(data));
  }

  /** Lecture directe d'un document pour les assertions. */
  peek(p) { return clone(this.store.get(p)); }
  /** Écriture directe (préparation d'un scénario), sans passer par les services. */
  seed(p, data) { this.store.set(p, clone(data)); }
}

/** Remplace `src/config/firebase.js` par le faux ; à appeler AVANT de charger les services. */
const installFakeFirebase = () => {
  const target = require.resolve(path.join(__dirname, '..', '..', 'src', 'config', 'firebase.js'));
  const db = new FakeDb();
  require.cache[target] = { id: target, filename: target, loaded: true, exports: { db, admin: { firestore: { FieldValue, FieldPath } } } };
  return db;
};

module.exports = { installFakeFirebase, FakeDb };
