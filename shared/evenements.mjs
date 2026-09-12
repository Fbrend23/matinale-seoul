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

/**
 * Le lien de recherche Naver Map, construit du lieu et du quartier.
 *
 * Le dépôt interdit de reconstruire une URL, et cette fonction en construit
 * une : la différence est ce qu'elle affirme. Une source reconstruite publie
 * un fait qu'on n'a pas vu ; un lien de recherche pose à Naver la question que
 * le lecteur aurait tapée lui-même. Il ne peut pas être faux, seulement vide.
 *
 * Le quartier est dans la requête pour départager les enseignes à plusieurs
 * adresses — « Pokémon Center » en a trois à Séoul.
 *
 * @param {{venue: string, area?: string|null}} event
 * @returns {string}
 */
export function lienNaverMap({ venue, area }) {
  const requête = `${venue} ${area ?? ''}`.trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(requête)}`;
}

/**
 * En cours, à venir — et les terminés sortent.
 *
 * Comparaison de chaînes AAAA-MM-JJ, comme partout dans le dépôt : l'ordre
 * des chaînes est celui des jours. `end_date` est le dernier jour INCLUS, donc
 * un événement qui finit aujourd'hui est encore en cours ce soir.
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
    (event.start_date <= today ? enCours : àVenir).push(event);
  }

  return { enCours, àVenir };
}
