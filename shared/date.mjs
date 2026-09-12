// Le jour à Séoul, partagé par l'ingestion et par le site.
//
// Même raison que sections.mjs et meteo.mjs, et le même risque : cette fonction
// existait en deux exemplaires — seoulDate() dans les gardes, seoulToday() sur
// le site — pour un seul et même calcul. Deux copies qui divergeraient feraient
// recaler un brief que le site daterait pourtant correctement, sans que rien
// n'échoue nulle part.
//
// Le brief parle de Séoul et paraît le matin, heure de Séoul. Le runner qui
// construit le site, lui, vit en UTC : laisser la machine décider du jour
// daterait le brief de la veille une bonne partie de la journée. Le fuseau est
// donc toujours nommé, jamais sous-entendu.

export const SEOUL = 'Asia/Seoul';

/**
 * Le jour courant à Séoul, en AAAA-MM-JJ.
 *
 * « en-CA » n'est pas un choix de langue : c'est le seul identifiant de locale
 * dont le format court soit précisément AAAA-MM-JJ, ce qui rend deux dates
 * comparables comme des chaînes.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Écart en jours entre deux jours AAAA-MM-JJ, ancré sur UTC : un jour ISO n'a
 * pas de fuseau, et lui en prêter un ferait rendre 30,96 jours arrondis au
 * petit bonheur par-dessus un changement d'heure.
 */
export function joursEntre(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Le jour AAAA-MM-JJ décalé de n jours. */
export function jourPlus(jour, n) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
