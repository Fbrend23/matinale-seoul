// TROIS RANGS DE SOURCES, ET CE QUE CHACUN AUTORISE.
//
// POURQUOI. Une seule liste posait la même question à deux problèmes
// différents. Pour un ITEM d'actualité, « qui le dit ? » : il faut une
// rédaction, et un domaine inconnu retient le brief en brouillon le temps
// qu'un humain regarde. Pour un ÉVÉNEMENT, la question n'est pas la même :
// c'est « cela existe-t-il, à ces dates, à cet endroit ? », et sur ce
// point-là la page du lieu ou de la marque qui l'organise vaut MIEUX qu'un
// article — elle est la décision elle-même, pas son compte rendu.
//
// CE QUE ÇA COÛTAIT. Les pop-ups d'idols et de petites marques ne passent par
// aucune rédaction : ils sont annoncés par le label, par le grand magasin qui
// les héberge, et repris par les recenseurs coréens. La consigne disait donc,
// mot pour mot, « introuvable chez eux : laisse-le », et l'onglet ne tenait,
// le 19 septembre 2026, que DEUX pop-ups K-pop sur quarante-six — quand Séoul
// en a une quinzaine en permanence. Ce n'étaient pas des oublis : ces
// événements étaient hors d'atteinte par construction.
//
// LES TROIS RANGS
//   presse      les rédactions. Citables partout, items compris. Inchangé.
//   officiels   le lieu, l'enseigne, le label, l'organisateur. Citables pour
//               un ÉVÉNEMENT, jamais pour un item : une annonce n'est pas de
//               l'information vérifiée par un tiers, et la garde 3 garde son
//               contrat éditorial intact.
//   agrégateurs les recenseurs (popply, popga, dayforyou) et les réseaux.
//               JAMAIS cités, ni pour un item ni pour un événement. Ils
//               disent où chercher ; le rang ne sert qu'à le dire clairement
//               dans le journal plutôt que « domaine inconnu ».
//
// Ce module ne lit aucun fichier : chaque script lit config/sources.json comme
// il le faisait déjà et passe l'objet ici. Un rang ne se devine pas d'un nom
// de domaine, il se décide par un commit, comme l'allowlist avant lui.

/**
 * Les trois rangs, d'un config/sources.json analysé.
 *
 * `pourÉvénements` est ce que reçoit contrôlerÉvénements() : la presse ET les
 * officiels, dédoublonnés. Les scripts ne recomposent donc jamais la liste
 * eux-mêmes — le contrôle avant vol doit PRÉDIRE l'ingestion, et deux
 * assemblages faits à deux endroits finiraient par diverger.
 *
 * @param {{domains?: string[], event_domains?: {domains?: string[]}, aggregators?: {domains?: string[]}}} config
 * @returns {{presse: string[], officiels: string[], pourÉvénements: string[], agrégateurs: string[]}}
 */
export function rangsDeSources(config = {}) {
  const presse = [...(config.domains ?? [])];
  const officiels = [...(config.event_domains?.domains ?? [])];
  const agrégateurs = [...(config.aggregators?.domains ?? [])];
  return {
    presse,
    officiels,
    pourÉvénements: [...new Set([...presse, ...officiels])],
    agrégateurs,
  };
}
