// Le mot du jour : un mot de coréen par brief, pour le lecteur qui apprend.
//
// PUR, et sans CMS : la liste vit dans config/vocabulaire.json, et le mot d'un
// jour se calcule de sa date. Rien n'est demandé à l'agent, qui a dix-huit
// minutes de marge le matin et n'a pas à choisir un mot ; rien n'est stocké
// dans Directus, un brief d'archive garde son mot pour toujours tant que la
// liste ne bouge pas avant lui.
//
// Le n-ième jour depuis DEBUT montre la n-ième fiche, et la liste se rejoue
// quand elle est épuisée. D'où la règle du fichier : AJOUTER À LA FIN. Une
// insertion au milieu décalerait tous les jours qui suivent, et le brief du
// 12 septembre changerait de mot un an après sa parution.

import { joursEntre, jourPlus } from '../../shared/date.mjs';
import vocabulaire from '../../config/vocabulaire.json' with { type: 'json' };

/** Le premier jour qui porte un mot : avant le premier brief, pour que toute l'archive en ait un. */
export const DEBUT = '2026-09-01';

/** Les fiches, dans l'ordre du fichier. */
export const MOTS = vocabulaire.mots;

/**
 * @typedef {object} Mot
 * @property {string} mot            en hangul
 * @property {string} romanisation   romanisation révisée
 * @property {string} sens           en français
 * @property {{ko: string, fr: string}} exemple
 */

/**
 * La fiche d'un jour, ou null avant DEBUT.
 *
 * @param {string} date  AAAA-MM-JJ
 * @param {Mot[]} [mots]  injectable pour les tests
 * @returns {(Mot & {rang: number})|null}
 */
export function motDuJour(date, mots = MOTS) {
  if (!mots.length || date < DEBUT) return null;
  const rang = joursEntre(DEBUT, date);
  return { ...mots[rang % mots.length], rang };
}

/**
 * Tous les mots parus, du plus récent au plus ancien, chacun avec sa date.
 * Un mot rejoué après un tour complet de la liste apparaît à chacune de ses
 * dates : la page dit ce que le site a montré.
 *
 * @param {string} jusquau  AAAA-MM-JJ, le dernier jour paru
 * @param {Mot[]} [mots]
 * @returns {(Mot & {rang: number, date: string})[]}
 */
export function motsParus(jusquau, mots = MOTS) {
  const parus = [];
  if (!mots.length) return parus;
  for (let rang = joursEntre(DEBUT, jusquau); rang >= 0; rang--) {
    parus.push({ ...mots[rang % mots.length], rang, date: jourPlus(DEBUT, rang) });
  }
  return parus;
}

/**
 * Ce qui rend une fiche fausse, pour le test qui garde le fichier.
 *
 * @param {Mot} fiche
 * @returns {string[]}
 */
export function fautesDeFiche(fiche) {
  const fautes = [];
  const hangul = /[가-힣]/;
  if (!hangul.test(fiche.mot ?? '')) fautes.push('mot sans hangul');
  if (!fiche.romanisation?.trim()) fautes.push('romanisation vide');
  if (!fiche.sens?.trim()) fautes.push('sens vide');
  if (!hangul.test(fiche.exemple?.ko ?? '')) fautes.push('exemple coréen sans hangul');
  if (!fiche.exemple?.fr?.trim()) fautes.push('exemple français vide');
  return fautes;
}
