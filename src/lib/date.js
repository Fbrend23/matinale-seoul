// Dates.
//
// Le brief parle de Séoul et paraît le matin, heure de Séoul. Le runner qui
// construit le site, lui, vit en UTC : laisser la machine décider du jour
// daterait le brief de la veille une bonne partie de la journée. Le fuseau est
// donc toujours nommé, jamais sous-entendu.

export const SEOUL = 'Asia/Seoul';

/** Le jour courant à Séoul, en AAAA-MM-JJ. */
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** « jeudi 4 septembre 2026 » — la date affichée en tête de brief. */
export function longDate(isoDay) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${isoDay}T12:00:00Z`));
}

/** « 4 sept. » — pour les listes d'archive. */
export function shortDate(isoDay) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${isoDay}T12:00:00Z`));
}

/** L'heure de publication d'une source, dite à Séoul puisque c'est là qu'on lit. */
export function sourceTime(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: SEOUL,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Écart en jours entre deux jours ISO. Sert à dire « le brief date d'hier ». */
export function daysBetween(a, b) {
  const ms = new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
