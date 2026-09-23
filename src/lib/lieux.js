// Quels lieux méritent une page, et ce qu'ils y portent.
//
// PUR, comme tags.js et pour la même raison : ce module reçoit des événements
// et rend un regroupement, sans rien savoir du CMS. C'est ce qui le rend
// testable, et importable par le contrôle de rendu.
//
// UNE SEULE RÈGLE, POUR DEUX USAGES. Les pages par lieu sont construites
// d'ici, et la carte d'événement décide d'ici si le lieu porte un lien. Deux
// règles qui divergeraient sèmeraient des liens vers des pages inexistantes.

import { estLancement, normaliserLieu, trierEvents } from '../../shared/evenements.mjs';

export { normaliserLieu };

/**
 * En dessous, pas de page.
 *
 * Une page qui ne montre qu'un événement recopie sa carte : elle n'apprend
 * rien, et ajoute une adresse à indexer. Même seuil que les étiquettes, et
 * même conséquence : le lieu reste affiché sur la carte, il n'est simplement
 * pas cliquable.
 */
export const MIN_EVENTS_PAR_LIEU = 2;

/**
 * Le slug d'un lieu : « lieu-» et huit hexadécimaux, calculés sur le nom
 * normalisé.
 *
 * Un nom coréen dans une adresse est possible, Astro écrit le dossier et le
 * serveur le sert, mais un dossier en hangul déposé par FTPS sur un mutualisé
 * est une surprise qu'on ne veut pas au premier déploiement. Ces adresses ne
 * se tapent pas, elles se cliquent : elles peuvent être opaques, pas
 * fragiles. FNV-1a, sans dépendance : trente-deux bits suffisent pour quelques
 * dizaines de lieux, et le calcul est le même partout où le module tourne.
 *
 * @param {string} venue
 * @returns {string}
 */
export function slugLieu(venue) {
  const clé = normaliserLieu(venue);
  let h = 0x811c9dc5;
  for (let i = 0; i < clé.length; i++) {
    h ^= clé.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `lieu-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Les lieux retenus, chacun avec ses événements, du plus pressé au plus
 * lointain.
 *
 * Le nom et le quartier affichés sont ceux du premier événement rencontré :
 * la liste arrive triée, c'est donc l'événement le plus proche qui nomme le
 * lieu, et deux graphies à une espace près se rangent sous la même page.
 *
 * @template {{venue: string, area: string, name: string, start_date: string, end_date: string}} E
 * @param {E[]} events
 * @param {{minEvents?: number}} [options]
 * @returns {Map<string, {venue: string, area: string, events: E[]}>}
 */
export function grouperParLieu(events, { minEvents = MIN_EVENTS_PAR_LIEU } = {}) {
  const parLieu = new Map();

  for (const event of trierEvents(events, 'fin')) {
    // Un lancement a pour lieu une chaîne, « 맥도날드 » : pas un endroit où
    // se rendre, et deux lancements chez elle n'en feraient pas un.
    if (estLancement(event)) continue;
    const slug = slugLieu(event.venue);
    if (!parLieu.has(slug)) parLieu.set(slug, { venue: event.venue, area: event.area, events: [] });
    parLieu.get(slug).events.push(event);
  }

  for (const [slug, lieu] of parLieu) {
    if (lieu.events.length < minEvents) parLieu.delete(slug);
  }

  return parLieu;
}
