/**
 * Pagination par curseur (contrat V2.1 : `CursorPage<T>` = { items, nextCursor, total? }).
 * Le curseur est un index opaque encodé en base64url.
 */
const decodeCursor = (cursor) => {
  if (!cursor) return 0;
  const n = Number(Buffer.from(String(cursor), 'base64url').toString());
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const encodeCursor = (offset) => Buffer.from(String(offset)).toString('base64url');

/** Découpe une liste déjà triée en page `CursorPage`. */
const cursorPage = (all, cursor, limit, { withTotal = true } = {}) => {
  const start = decodeCursor(cursor);
  const size = Math.min(100, Math.max(1, Number(limit) || 20));
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? encodeCursor(start + size) : null;
  return { items, nextCursor: next, ...(withTotal && { total: all.length }) };
};

module.exports = { cursorPage, decodeCursor, encodeCursor };
