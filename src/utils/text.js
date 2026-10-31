/** Normalise pour comparer sans casse ni accents (miroir de `normalize` côté front). */
const normalize = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

/** Mots de recherche (2 caractères minimum), normalisés. */
const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// 8 chiffres ou plus, séparés ou non (numéros camerounais 6XXXXXXXX, +237…)
const PHONE_RE = /\+?\d(?:[\s.\-/]?\d){7,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|cm|fr|me|io|info|biz)\b(?:\/\S*)?/gi;

/**
 * Masque coordonnées et liens dans un texte publié (contrat V2.1, étape 5 « Textes publiés ») :
 * le contact passe par la messagerie.
 */
const maskContacts = (text) => {
  if (typeof text !== 'string') return text;
  return text
    .replace(EMAIL_RE, '[coordonnée masquée]')
    .replace(URL_RE, '[lien retiré]')
    .replace(PHONE_RE, '[coordonnée masquée]');
};

/**
 * Modération d'un message de messagerie : mêmes règles que `maskContacts`, avec les indicateurs du contrat
 * (`contact_masked`, `link_blocked`). Limite connue : une coordonnée écrite en toutes lettres ou volontairement
 * déformée (« six sept sept… », « 6 7 7 point… ») n'est pas détectée.
 * @returns {{ text: string, moderation: string[] }}
 */
const moderateMessage = (text) => {
  const moderation = new Set();
  const replace = (re, label, flag) => (s) => s.replace(re, () => { moderation.add(flag); return label; });
  const out = [
    replace(EMAIL_RE, '[coordonnée masquée]', 'contact_masked'),
    replace(URL_RE, '[lien retiré]', 'link_blocked'),
    replace(PHONE_RE, '[coordonnée masquée]', 'contact_masked'),
  ].reduce((s, step) => step(s), String(text));
  return { text: out, moderation: [...moderation] };
};

module.exports = { normalize, tokenize, maskContacts, moderateMessage };
