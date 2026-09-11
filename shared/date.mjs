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
