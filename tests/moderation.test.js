const test = require('node:test');
const assert = require('node:assert/strict');
const { moderateMessage } = require('../src/utils/text');

test('message sans coordonnée : inchangé, aucun indicateur', () => {
  assert.deepEqual(moderateMessage('Bonjour, êtes-vous disponible lundi ?'), { text: 'Bonjour, êtes-vous disponible lundi ?', moderation: [] });
});

test('numéros masqués (formats camerounais usuels) ⇒ contact_masked', () => {
  for (const t of ['Appelez le 677112233', 'Mon numéro : +237 677 11 22 33', 'wa 6 77 11 22 33', '677.11.22.33']) {
    const r = moderateMessage(t);
    assert.ok(r.text.includes('[coordonnée masquée]'), t);
    assert.deepEqual(r.moderation, ['contact_masked'], t);
    assert.ok(!/\d{4}/.test(r.text), `chiffres restants dans « ${r.text} »`);
  }
});

test('e-mail masqué', () => {
  const r = moderateMessage('ecrivez a jean.dupont@gmail.com svp');
  assert.equal(r.text, 'ecrivez a [coordonnée masquée] svp');
  assert.deepEqual(r.moderation, ['contact_masked']);
});

test('liens retirés ⇒ link_blocked', () => {
  for (const t of ['voir https://exemple.com/profil', 'www.monsite.cm/x', 'mon site monsite.com']) {
    const r = moderateMessage(t);
    assert.ok(r.text.includes('[lien retiré]'), t);
    assert.deepEqual(r.moderation, ['link_blocked'], t);
  }
});

test('plusieurs infractions : les deux indicateurs, sans doublon', () => {
  const r = moderateMessage('tel 677112233 ou 699887766, site www.x.cm');
  assert.deepEqual(r.moderation.sort(), ['contact_masked', 'link_blocked']);
});

test('un montant ordinaire n’est pas pris pour un numéro', () => {
  const r = moderateMessage('Salaire proposé : 150 000 FCFA par mois');
  assert.deepEqual(r.moderation, []);
});

test('limite connue : numéro écrit en lettres non détecté', () => {
  assert.deepEqual(moderateMessage('six sept sept un un deux deux trois trois').moderation, []);
});
