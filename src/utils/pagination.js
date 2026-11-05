
const { AppError } = require('./AppError');

const invalidParameter = (field) =>
  new AppError(
    `Paramètre ${field} invalide.`,
    422,
    'VALIDATION_ERROR'
  );

// Encode une position entière en base64url.
const encodeCursor = (offset) =>
  Buffer.from(String(offset)).toString('base64url');

// Décode et valide strictement un curseur.
const decodeCursor = (cursor) => {
  if (cursor === undefined || cursor === null || cursor === '') {
    return 0;
  }

  if (
    typeof cursor !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw invalidParameter('cursor');
  }

  const decoded = Buffer
    .from(cursor, 'base64url')
    .toString('utf8');

  if (!/^(0|[1-9]\d*)$/.test(decoded)) {
    throw invalidParameter('cursor');
  }

  const offset = Number(decoded);

  if (
    !Number.isSafeInteger(offset) ||
    encodeCursor(offset) !== cursor
  ) {
    throw invalidParameter('cursor');
  }

  return offset;
};

// Vérifie la limite de résultats.
const parseLimit = (limit) => {
  if (
    limit === undefined ||
    limit === null ||
    limit === '' ||
    limit === 0
  ) {
    return 20;
  }

  const n = Number(limit);

  if (!Number.isSafeInteger(n) || n <= 0) {
    throw invalidParameter('limit');
  }

  return Math.min(100, n);
};

// Découpe une liste déjà triée.
const cursorPage = (
  all,
  cursor,
  limit,
  { withTotal = true } = {}
) => {
  const start = decodeCursor(cursor);
  const size = parseLimit(limit);

  const items = all.slice(start, start + size);

  const next =
    start + size < all.length
      ? encodeCursor(start + size)
      : null;

  return {
    items,
    nextCursor: next,
    ...(withTotal && { total: all.length }),
  };
};

module.exports = {
  cursorPage,
  decodeCursor,
  encodeCursor,
};
