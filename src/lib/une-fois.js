// Une requête, une fois, pour la durée d'un build.
//
// Six pages demandaient la même liste de briefs, cinq d'entre elles la même
// liste d'items : onze requêtes pour deux réponses, vers une instance mutualisée
// de 384 Mo dont le pool ne tient que trois connexions.
//
// Dans son propre module parce que content.js dépend d'« astro:env », qui ne se
// résout pas hors d'Astro : le cache y serait resté non testé, alors que c'est
// la pièce qui pourrait trahir la doctrine du dépôt sans bruit.

/**
 * Mémoïse par clé, pour la durée du processus.
 *
 * Le build est un processus unique et le contenu est figé pour sa durée : c'est
 * ce qui rend la mémoïsation sûre ici, et nulle part ailleurs.
 *
 * ON MÉMOÏSE LA PROMESSE, PAS LE RÉSULTAT. Deux pages rendues en parallèle
 * doivent partager la requête EN VOL ; garder la valeur les ferait partir toutes
 * les deux avant que la première ne revienne.
 *
 * CE N'EST PAS UN REPLI. Un rejet est gardé tel quel et relancé à l'identique :
 * quand le CMS ne répond pas, le build doit échouer, pas servir du figé.
 *
 * @returns {(clé: string, produire: () => Promise<any>) => Promise<any>}
 */
export function créerMémo() {
  const enCache = new Map();

  return function uneFois(clé, produire) {
    if (!enCache.has(clé)) enCache.set(clé, produire());
    return enCache.get(clé);
  };
}
