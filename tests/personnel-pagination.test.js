
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cursorPage,
  decodeCursor,
} = require('../src/utils/pagination');

const candidats = Array.from({ length: 6 }, (_, i) => ({
  id: `candidat_${i + 1}`,
}));

test('Pagination : parcourir plusieurs pages sans doublon', () => {
  const page1 = cursorPage(candidats, null, 2);

  const page2 = cursorPage(
    candidats,
    page1.nextCursor,
    2
  );

  const page3 = cursorPage(
    candidats,
    page2.nextCursor,
    2
  );

  const ids = [
    ...page1.items,
    ...page2.items,
    ...page3.items,
  ].map((c) => c.id);

  assert.deepEqual(ids, candidats.map((c) => c.id));

  assert.equal(new Set(ids).size, 6);
  assert.equal(page3.nextCursor, null);
  assert.equal(page1.total, 6);
});

test('Pagination : respecter la limite maximale de 100', () => {
  const candidatsNombreux = Array.from(
    { length: 120 },
    (_, i) => ({ id: `candidat_${i}` })
  );

  const page = cursorPage(candidatsNombreux, null, 500);

  assert.equal(page.items.length, 100);
  assert.equal(page.total, 120);
});

test('Pagination : une liste vide ne produit aucun curseur', () => {
  const page = cursorPage([], null, 20);

  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
  assert.equal(page.total, 0);
});

test('Pagination : un curseur invalide doit être refusé', () => {
  assert.throws(
    () => cursorPage(candidats, 'curseur-invalide!', 2),
    'Un curseur invalide ne doit pas redémarrer silencieusement'
  );
});

test('Pagination : une limite décimale doit être refusée', () => {
  assert.throws(
    () => cursorPage(candidats, null, 2.5),
    'Une limite décimale ne doit pas produire un curseur invalide'
  );
});
