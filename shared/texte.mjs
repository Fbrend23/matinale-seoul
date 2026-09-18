// Comparer du texte sans accents ni casse, partagé par l'ingestion et par le site.
//
// Même raison que date.mjs : l'ingestion réduit les titres pour repérer un
// doublon, le site réduit ce que le lecteur tape pour filtrer les cartes
// d'événements. Une règle en deux exemplaires dirait « pokemon » égal à
// « Pokémon » d'un côté et pas de l'autre, sans que rien n'échoue.

/**
 * Réduit un texte à ce qui se compare : sans casse, sans accents, sans
 * ponctuation.
 *
 * Toute lettre compte, pas seulement a-z : un nom d'événement en coréen se
 * réduisait au vide, et deux noms coréens sans rapport se ressemblaient
 * alors parfaitement. Le hangul est décomposé en jamo par la forme NFD, et
 * c'est tant mieux, les bigrammes comparent alors des lettres et non des
 * syllabes entières.
 *
 * @param {string} texte
 * @returns {string}
 */
export function normalize(texte) {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Le texte contient chaque mot de la requête, dans n'importe quel ordre.
 *
 * Des sous-chaînes, pas des mots entiers : « pokemon » trouve « Pokémon
 * Center », et « 포켓몬 » trouve « 포켓몬센터 », parce que le jamo d'une
 * syllabe se suit dans celui du mot.
 *
 * Les mots sont ceux que le lecteur a séparés par des espaces, et chacun est
 * comparé sans ponctuation au texte sans espaces : normalize() couperait
 * « k-pop » en « k » et « pop », et « k » se trouve dans presque toute carte.
 * Compacté, « kpop » trouve « K-pop », et rien d'autre. Une requête vide ne
 * filtre rien : c'est le champ avant qu'on y tape.
 *
 * @param {string} requête
 * @param {string} texte
 * @returns {boolean}
 */
export function correspond(requête, texte) {
  const compacter = (t) => normalize(t).replace(/ /g, '');
  const mots = (requête ?? '').split(/\s+/).map(compacter).filter(Boolean);
  if (mots.length === 0) return true;
  const réduit = compacter(texte ?? '');
  return mots.every((mot) => réduit.includes(mot));
}
