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

module.exports = { normalize, tokenize, maskContacts };
