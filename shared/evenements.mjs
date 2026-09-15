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
// propres contrôles, dont aucun ne recale jamais le brief.

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

// Les neuf thèmes de l'onglet, qui couvre tout ce qui se passe à Séoul et
// qu'on peut aller voir. Toujours pas de « autre » : les deux derniers,
// « culture » et « food », sont larges, mais ils disent quelque chose. Un
// seau sans nom deviendrait la sortie de secours d'un agent qui travaille
// avec dix-huit minutes de marge, et le filtre cesserait de servir. C'est le
// prompt qui dit où passe chaque frontière.
export const THEMES = ['anime', 'pokemon', 'kpop', 'gaming', 'personnages', 'mode', 'seoul', 'culture', 'food', 'sport'];

export const THEME_LABELS = {
  anime: 'Anime et manga',
  pokemon: 'Pokémon',
  kpop: 'K-pop',
  gaming: 'Jeu vidéo',
  personnages: 'Personnages',
  mode: 'Mode et marques',
  seoul: 'Festivals de Séoul',
  culture: 'Culture et expos',
  food: 'Food et boissons',
  sport: 'Sport',
};

export const THEMES_EN_PROSE = THEMES.map((clé) => THEME_LABELS[clé]).join(', ');

import { joursEntre } from './date.mjs';

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
 * tel que Naver l'écrit, c'est le schéma et le tri des événements qui le
 * demandent, et le quartier hors de la requête : romanisé pour le lecteur,
 * il ne ferait que brouiller une recherche coréenne. Une enseigne à plusieurs
 * adresses se départage dans le lieu lui-même : « 포켓몬센터 성수 ».
 *
 * @param {{venue: string}} event
 * @returns {string}
 */
export function lienNaverMap({ venue }) {
  return `https://map.naver.com/p/search/${encodeURIComponent(venue.trim())}`;
}

/**
 * Deux noms de lieu se comparent sans espaces ni casse : « KSPO돔 » = « KSPO 돔 ».
 *
 * Une seule règle pour la carte Kakao, qui compare ce que Kakao rend à ce
 * qu'elle a demandé, et pour les pages par lieu, qui regroupent les cartes :
 * deux règles diraient deux lieux là où le lecteur n'en voit qu'un. Rien de
 * plus malin : « COEX » et « 코엑스 » restent deux lieux, on ne devine pas.
 */
export function normaliserLieu(texte) {
  return (texte ?? '').replace(/\s+/g, '').toLowerCase();
}

/** Au moins une syllabe hangul : ce que Naver Map sait chercher. */
export function enCoréen(texte) {
  return /[\uAC00-\uD7A3]/.test(texte ?? '');
}

/**
 * Deux groupes, sans recouvrement, et les terminés sortent.
 *
 *   enCours  commencé et pas fini : on peut y aller aujourd'hui
 *   àVenir   pas encore commencé
 *
 * Il y a eu un groupe « ce week-end » entre les deux ; il coupait « en cours »
 * en deux selon la date de fin, et personne ne lisait la différence. Le badge
 * de la carte dit déjà combien de jours il reste. Comparaison de chaînes
 * AAAA-MM-JJ, comme partout : l'ordre des chaînes est celui des jours.
 * `end_date` est le dernier jour INCLUS.
 *
 * @template {{start_date: string, end_date: string}} E
 * @param {E[]} events
 * @param {string} today  le jour à Séoul
 * @returns {{enCours: E[], àVenir: E[]}}
 */
export function grouperParÉtat(events, today) {
  const enCours = [];
  const àVenir = [];

  for (const event of events) {
    if (event.end_date < today) continue;
    if (event.start_date <= today) enCours.push(event);
    else àVenir.push(event);
  }

  return { enCours, àVenir };
}

/**
 * Les tris de la page, dans l'ordre du menu. Le premier est celui du build :
 * ce qui finit le plus tôt d'abord, parce que c'est ce qu'on risque de rater.
 * Les deux autres se choisissent chez le lecteur.
 */
export const TRIS = ['fin', 'debut', 'nouveau'];
export const TRI_PAR_DEFAUT = TRIS[0];
export const TRI_LABELS = {
  fin: 'Finit bientôt',
  debut: 'Commence bientôt',
  nouveau: 'Repéré récemment',
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Le comparateur d'un tri. Chaîné jusqu'au nom pour que deux builds, ou le
 * build et le lecteur, rangent les mêmes cartes dans le même ordre. Les
 * dates sont des AAAA-MM-JJ et `date_created` un ISO 8601 : l'ordre des
 * chaînes est celui du temps.
 *
 * @param {string} tri  une clé de TRIS
 * @returns {(a: {name: string, start_date: string, end_date: string, date_created?: string}, b: typeof a) => number}
 */
export function comparateur(tri) {
  const parNom = (a, b) => cmp(a.name, b.name);
  switch (tri) {
    case 'debut':
      return (a, b) => cmp(a.start_date, b.start_date) || cmp(a.end_date, b.end_date) || parNom(a, b);
    case 'nouveau':
      return (a, b) => cmp(String(b.date_created ?? ''), String(a.date_created ?? '')) || cmp(a.end_date, b.end_date) || parNom(a, b);
    case 'fin':
    default:
      return (a, b) => cmp(a.end_date, b.end_date) || cmp(a.start_date, b.start_date) || parNom(a, b);
  }
}

/**
 * @template {{name: string, start_date: string, end_date: string, date_created?: string}} E
 * @param {E[]} events
 * @param {string} [tri]
 * @returns {E[]} une copie triée
 */
export function trierEvents(events, tri = TRI_PAR_DEFAUT) {
  return [...events].sort(comparateur(tri));
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
