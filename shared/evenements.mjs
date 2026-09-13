// Les pop-ups et événements, partagés par l'ingestion et par le site.
//
// Même raison que sections.mjs : l'ingestion valide `kind` et `theme` par le
// schéma, le site les affiche par leurs libellés et construit le lien Naver
// Map. Deux listes qui divergeraient afficheraient une pastille vide sans que
// rien n'échoue. Un test tient le schéma et ce fichier ensemble.
//
// CE N'EST PAS UNE CINQUIÈME RUBRIQUE. Une rubrique est éphémère : elle vit
// dans le brief du jour. Un événement, lui, dure jusqu'à sa date de fin, quel
// que soit le brief qui l'a repéré. Il a donc sa collection, sa page, et ses
// propres contrôles — dont aucun ne recale jamais le brief.

// Ce qu'on peut aller voir. « autre » existe ici parce qu'un lancement de jeu
// en boutique ou une projection ne sont ni un pop-up ni un concert.
export const KINDS = ['popup', 'concert', 'exposition', 'festival', 'salon', 'autre'];

export const KIND_LABELS = {
  popup: 'Pop-up',
  concert: 'Concert',
  exposition: 'Exposition',
  festival: 'Festival',
  salon: 'Salon',
  autre: 'Événement',
};

// Les quatre thèmes que l'onglet couvre, et rien d'autre : pas de « autre »
// ici. Un seau fourre-tout deviendrait la sortie de secours d'un agent qui
// travaille avec dix-huit minutes de marge, et l'onglet cesserait de parler
// de ce pour quoi il existe.
export const THEMES = ['anime', 'pokemon', 'kpop', 'gaming'];

export const THEME_LABELS = {
  anime: 'Anime et manga',
  pokemon: 'Pokémon',
  kpop: 'K-pop',
  gaming: 'Jeu vidéo',
};

export const THEMES_EN_PROSE = THEMES.map((clé) => THEME_LABELS[clé]).join(', ');

import { joursEntre, jourPlus } from './date.mjs';

/**
 * Le week-end qui vient : samedi et dimanche prochains — ou ceux en cours,
 * quand on est déjà dedans. Le dimanche, le samedi est passé : le week-end se
 * réduit au jour même, et ce qui a fermé la veille n'y figure plus.
 *
 * @param {string} today  le jour à Séoul
 * @returns {{samedi: string, dimanche: string}}
 */
export function weekEndDe(today) {
  const jour = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  const samedi = jour === 0 ? jourPlus(today, -1) : jourPlus(today, 6 - jour);
  return { samedi, dimanche: jourPlus(samedi, 1) };
}

/**
 * Le lien de recherche Naver Map, construit du lieu.
 *
 * Le dépôt interdit de reconstruire une URL, et cette fonction en construit
 * une : la différence est ce qu'elle affirme. Une source reconstruite publie
 * un fait qu'on n'a pas vu ; un lien de recherche pose à Naver la question que
 * le lecteur aurait tapée lui-même. Il ne peut pas être faux, seulement vide.
 *
 * Vide, c'est ce qu'il est quand la question est en anglais : Naver Map ne
 * connaît « Hiker Ground » que sous « 하이커그라운드 ». D'où `venue` en coréen,
 * tel que Naver l'écrit — c'est le schéma et le tri des événements qui le
 * demandent — et le quartier hors de la requête : romanisé pour le lecteur,
 * il ne ferait que brouiller une recherche coréenne. Une enseigne à plusieurs
 * adresses se départage dans le lieu lui-même : « 포켓몬센터 성수 ».
 *
 * @param {{venue: string}} event
 * @returns {string}
 */
export function lienNaverMap({ venue }) {
  return `https://map.naver.com/p/search/${encodeURIComponent(venue.trim())}`;
}

/** Au moins une syllabe hangul : ce que Naver Map sait chercher. */
export function enCoréen(texte) {
  return /[\uAC00-\uD7A3]/.test(texte ?? '');
}

/**
 * Trois groupes, sans recouvrement, et les terminés sortent.
 *
 *   ceWeekEnd  ouvert samedi ou dimanche prochains — la question qu'on se pose
 *              vraiment le jeudi soir. Un pop-up de deux mois y est aussi.
 *   enCours    ouvert aujourd'hui, mais fermé avant le week-end
 *   àVenir     commence après le week-end
 *
 * Sans recouvrement, parce qu'une grille de cartes qui répète les mêmes
 * cartes deux fois ne se parcourt plus. Comparaison de chaînes AAAA-MM-JJ,
 * comme partout : l'ordre des chaînes est celui des jours. `end_date` est le
 * dernier jour INCLUS.
 *
 * @template {{start_date: string, end_date: string}} E
 * @param {E[]} events
 * @param {string} today  le jour à Séoul
 * @returns {{ceWeekEnd: E[], enCours: E[], àVenir: E[], weekEnd: {samedi: string, dimanche: string}}}
 */
export function grouperParÉtat(events, today) {
  const weekEnd = weekEndDe(today);
  const ceWeekEnd = [];
  const enCours = [];
  const àVenir = [];

  for (const event of events) {
    if (event.end_date < today) continue;
    const ouvertCeWeekEnd = event.start_date <= weekEnd.dimanche && event.end_date >= weekEnd.samedi;
    if (ouvertCeWeekEnd) ceWeekEnd.push(event);
    else if (event.start_date <= today) enCours.push(event);
    else àVenir.push(event);
  }

  return { ceWeekEnd, enCours, àVenir, weekEnd };
}

/** En dessous, le badge passe en couleur : c'est le moment d'y aller. */
export const JOURS_URGENTS = 7;

/**
 * Le badge d'une carte : combien de jours il reste, ou dans combien de jours
 * ça commence. Le nombre plutôt qu'un « bientôt » : un pop-up est temporaire,
 * et « 3 jours » décide d'un week-end là où « bientôt » ne décide de rien.
 *
 * @param {{start_date: string, end_date: string}} event
 * @param {string} today
 * @returns {{texte: string, urgent: boolean}|null} null si terminé
 */
export function badgeDélai(event, today) {
  if (event.end_date < today) return null;

  if (event.start_date > today) {
    const dans = joursEntre(today, event.start_date);
    return { texte: dans === 1 ? 'Demain' : `Dans ${dans} jours`, urgent: false };
  }

  const reste = joursEntre(today, event.end_date);
  if (reste === 0) return { texte: 'Dernier jour', urgent: true };
  return { texte: reste === 1 ? '1 jour restant' : `${reste} jours restants`, urgent: reste <= JOURS_URGENTS };
}
