// L'archive, rangée par mois.
//
// PUR, comme tags.js et pour la même raison : ce module reçoit des briefs et
// rend un regroupement, sans rien savoir du CMS. C'est ce qui le rend testable,
// là où la page qui l'appelle dépend d'« astro:env ».
//
// Les libellés sont ancrés en UTC, comme toutes les dates du site : un jour
// ISO n'a pas de fuseau, et lui en prêter un décalerait le mois d'un jour une
// partie de la journée. Le 15 est choisi parce qu'aucun décalage ne le fait
// changer de mois.

/** En dessous, pas de barre de navigation : une ancre vers la seule section ne mène nulle part. */
export const MIN_MOIS_POUR_NAV = 2;

/** « 2026-09 » : la clé d'un mois, celle qui trie et qui sert d'ancre. */
export function cléMois(date) {
  return date.slice(0, 7);
}

function formateur(mois) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: mois, year: 'numeric' });
}

/** « septembre 2026 », le titre d'une section. */
export function moisLisible(clé) {
  return formateur('long').format(new Date(`${clé}-15T12:00:00Z`));
}

/** « sept. 2026 », l'ancre de la barre de navigation. */
export function moisCourt(clé) {
  return formateur('short').format(new Date(`${clé}-15T12:00:00Z`));
}

/**
 * Les briefs regroupés par mois, dans l'ordre où ils arrivent.
 *
 * L'ordre n'est pas retrié ici : listBriefs() rend du plus récent au plus
 * ancien, et c'est cet ordre que la page veut. Un mois commence au premier
 * brief qui le porte, et ne peut être que le dernier groupe ajouté.
 *
 * @template {{date: string}} B
 * @param {B[]} briefs
 * @returns {{clé: string, id: string, briefs: B[]}[]}
 */
export function grouperParMois(briefs) {
  const groupes = [];
  for (const brief of briefs) {
    const clé = cléMois(brief.date);
    const dernier = groupes.at(-1);
    if (dernier?.clé === clé) dernier.briefs.push(brief);
    else groupes.push({ clé, id: `mois-${clé}`, briefs: [brief] });
  }
  return groupes;
}
