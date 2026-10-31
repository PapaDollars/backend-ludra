const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeDb } = require('./helpers/fakeFirestore');

// Garde-fou : le faux doit se comporter comme Firestore sur les points dont dépendent les autres tests.
test('create() refuse un id existant (code 6) ; update() refuse un document absent (code 5)', async () => {
  const db = new FakeDb();
  await db.collection('a').doc('1').create({ x: 1 });
  await assert.rejects(db.collection('a').doc('1').create({ x: 2 }), (e) => e.code === 6);
  await assert.rejects(db.collection('a').doc('nope').update({ x: 2 }), (e) => e.code === 5);
});

test('undefined interdit dans une écriture', async () => {
  const db = new FakeDb();
  await assert.rejects(db.collection('a').doc('1').set({ x: undefined }), /undefined/);
});

test('transaction : lire après écrire est refusé', async () => {
  const db = new FakeDb();
  db.seed('a/1', { n: 1 });
  await assert.rejects(db.runTransaction(async (tx) => {
    tx.update(db.collection('a').doc('1'), { n: 2 });
    await tx.get(db.collection('a').doc('1'));
  }), /reads to be executed before all writes/);
  assert.equal(db.peek('a/1').n, 1, 'aucune écriture appliquée après une erreur');
});

test('chemins pointés et increment dans update()', async () => {
  const db = new FakeDb();
  db.seed('c/1', { unread: { u1: 0 } });
  const { installFakeFirebase } = require('./helpers/fakeFirestore');
  void installFakeFirebase;
  await db.collection('c').doc('1').update({ 'unread.u1': { __op: 'increment', n: 2 }, 'lastReadAt.u2': 'x' });
  assert.deepEqual(db.peek('c/1'), { unread: { u1: 2 }, lastReadAt: { u2: 'x' } });
});

test('requêtes : where/orderBy/limit/startAfter/array-contains/count, sous-collections isolées', async () => {
  const db = new FakeDb();
  db.seed('p/a', { u: 'x', at: '3', tags: ['t1'] });
  db.seed('p/b', { u: 'x', at: '1', tags: ['t2'] });
  db.seed('p/c', { u: 'y', at: '2', tags: ['t1'] });
  db.seed('p/a/sub/z', { u: 'x', at: '9' });
  const ids = async (q) => (await q.get()).docs.map((d) => d.id);
  assert.deepEqual(await ids(db.collection('p').where('u', '==', 'x').orderBy('at', 'desc')), ['a', 'b']);
  assert.deepEqual(await ids(db.collection('p').orderBy('at').startAfter('1').limit(1)), ['c']);
  assert.deepEqual(await ids(db.collection('p').where('tags', 'array-contains', 't1').orderBy('at')), ['c', 'a']);
  assert.equal((await db.collection('p').where('u', '==', 'x').count().get()).data().count, 2);
  db.simulateMissingIndex = true;
  await assert.rejects(db.collection('p').where('u', '==', 'x').orderBy('at').get(), (e) => e.code === 9);
});
