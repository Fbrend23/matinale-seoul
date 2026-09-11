// Quelles étiquettes méritent une page, et ce qu'elles y portent.
//
// PUR, et sans lien avec le CMS : ce module reçoit des briefs et rend un
// regroupement. C'est ce qui le rend testable, là où content.js dépend
// d'« astro:env » et ne se charge pas hors d'Astro.
//
// UNE SEULE RÈGLE, POUR DEUX USAGES. Les pages d'étiquette sont construites
// d'ici, et NewsItem décide d'ici s'il pose un lien. Deux règles qui
// divergeraient produiraient des liens vers des pages inexistantes — un 404 par
// étiquette, sur un site statique où rien ne le signalerait.

/** Au-delà, une étiquette se lit par l'archive — même fenêtre que les rubriques. */
export const TAG_WINDOW_DAYS = 30;

/**
 * En dessous, pas de page.
 *
 * Sur les premiers briefs, 80 étiquettes sur 97 ne portaient qu'un seul item.
 * Une page qui ne montre qu'un item ne regroupe rien : elle recopie cet item,
 * ajoute une adresse à indexer, et fait grossir le sitemap sans rien apprendre
 * à personne. Le seuil ne perd aucune information — l'item reste sur son brief
 * et dans sa rubrique, l'étiquette reste affichée, elle n'est simplement pas
 * cliquable.
 */
export const MIN_ITEMS_PAR_TAG = 2;

/**
 * Les étiquettes retenues, chacune avec ses jours et leurs items.
 *
 * @param {any[]} briefs  des briefs assemblés, du plus récent au plus ancien
 * @param {{minItems?: number}} [options]
 * @returns {Map<string, {brief: any, items: any[]}[]>}
 */
export function groupByTag(briefs, { minItems = MIN_ITEMS_PAR_TAG } = {}) {
  const parTag = new Map();

  for (const brief of briefs) {
    for (const section of brief.sections) {
      for (const item of section.items) {
        for (const tag of item.tags ?? []) {
          if (!parTag.has(tag)) parTag.set(tag, []);
          const jours = parTag.get(tag);

          // Les items d'un même jour se regroupent sous une seule date, comme
          // sur les pages de rubrique. Les briefs arrivant dans l'ordre, le
          // jour courant ne peut être que le dernier ajouté.
          const dernier = jours.at(-1);
          if (dernier?.brief.id === brief.id) dernier.items.push(item);
          else jours.push({ brief, items: [item] });
        }
      }
    }
  }

  for (const [tag, jours] of parTag) {
    const total = jours.reduce((n, jour) => n + jour.items.length, 0);
    if (total < minItems) parTag.delete(tag);
  }

  return parTag;
}
