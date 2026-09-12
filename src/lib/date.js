// Dates.
//
// Le brief parle de Séoul et paraît le matin, heure de Séoul. Le runner qui
// construit le site, lui, vit en UTC : laisser la machine décider du jour
// daterait le brief de la veille une bonne partie de la journée. Le fuseau est
// donc toujours nommé, jamais sous-entendu.

// Le jour à Séoul vient de shared/ : l'ingestion le calcule aussi, et les deux
// doivent rendre le même verdict. Réexporté ici pour que les pages continuent de
// s'adresser à un seul module de dates.
//
// Importé ET réexporté : sourceTime() se sert de SEOUL plus bas, et une simple
// réexportation ne met pas le nom dans la portée du module.
import { SEOUL, seoulToday } from '../../shared/date.mjs';
export { SEOUL, seoulToday };

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

/**
 * « du 5 sept. au 12 oct. », ou « le 5 sept. » pour un événement d'un jour.
 *
 * Même format court que les listes d'archive, et même ancrage UTC : un jour
 * ISO n'a pas de fuseau, et lui en prêter un décalerait la date d'un jour une
 * partie de la journée.
 */
export function dateRange(début, fin) {
  if (fin === début) return `le ${shortDate(début)}`;
  return `du ${shortDate(début)} au ${shortDate(fin)}`;
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
