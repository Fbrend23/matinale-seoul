// L'onglet « Pop-ups & événements » tel que le site le publie, lu par les
// scripts du matin.
//
// Deux scripts en ont besoin, et pour la même raison : ne pas reproposer ce
// qui est déjà en ligne. La recherche le donne à Gemini dans sa consigne et
// aux gardes pour les doublons ; le registre s'en sert pour son diff. Une
// seule lecture, une seule façon de dire la panne.
//
// LA PANNE N'EST PAS UNE LISTE VIDE. Un onglet injoignable rendu comme « rien
// n'est connu » ferait reproposer, le matin d'un incident, les quatre-vingts
// événements déjà en ligne. Les deux appelants journalisent donc `panne`, et
// le registre, lui, s'arrête : un diff contre une liste vide n'est pas un diff.

const SITE_PAR_DÉFAUT = 'https://matinale.brendanfleurdelys.ch';

/** L'adresse du site publié, sans barre finale. */
export function siteDuDépôt(env = process.env) {
  return (env.SITE_URL ?? SITE_PAR_DÉFAUT).replace(/\/$/, '');
}

/**
 * Les événements actifs de l'onglet, avec leurs dates.
 *
 * Les dates comptent autant que les noms : sans elles, toute ressemblance
 * serait un doublon, et une prolongation ne se reconnaîtrait pas.
 *
 * @param {object} [p]
 * @param {string} [p.site]
 * @param {Function} [p.fetcher]   injectable, comme dans guards.mjs
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{connus: object[], panne: string|null}>}
 */
export async function connusDuSite({ site = siteDuDépôt(), fetcher = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${site}/api/evenements.json`, { signal: controller.signal });
    if (!res.ok) return { connus: [], panne: `HTTP ${res.status}` };
    const { events } = await res.json();
    return { connus: Array.isArray(events) ? events : [], panne: null };
  } catch (e) {
    return { connus: [], panne: e.name === 'AbortError' ? `délai de ${timeoutMs} ms dépassé` : e.message };
  } finally {
    clearTimeout(minuteur);
  }
}
