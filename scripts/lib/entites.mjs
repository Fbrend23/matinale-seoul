// LE BALAYAGE PAR ENTITÉ : chercher par NOM, pas seulement par thème.
//
// POURQUOI. Le single « CLICK » de Jisoo est sorti le 4 septembre 2026 ; son
// pop-up a été annoncé le 17 au soir, sur Instagram, et deux jours plus tard il
// n'était encore dans aucun registre ni aucune rédaction. Les dix thèmes de la
// recherche ne pouvaient pas le trouver : « 아이돌 팝업스토어 » remonte ce qui est
// déjà listé quelque part, et un pop-up qui n'est nulle part n'est dans aucune
// liste. Un NOM PROPRE, lui, se cherche — « 지수 팝업 » l'aurait rendu le jour
// même.
//
// CE QU'ON SURVEILLE, et pourquoi c'est calculable : un pop-up d'idol suit
// presque toujours une sortie. Comeback, single, album, tournée, fan meeting :
// l'annonce du disque passe dans la presse (Soompi l'a écrit), le pop-up
// n'y passe pas. On tient donc la liste des noms qui viennent de sortir
// quelque chose, et on demande à Gemini une requête par nom. Le délai observé
// est de deux semaines (Jisoo : treize jours), d'où la fenêtre de trois
// semaines : assez pour couvrir, assez court pour que la liste reste courte.
//
// D'OÙ VIENNENT LES NOMS. Deux sources, aucune nouvelle dépendance :
//   · le flux RSS de Soompi, lu ICI et pas par la veille du brief. Le mettre
//     dans config/flux.json ferait entrer des titres K-pop dans les rubriques
//     du brief, qui n'en ont pas. Le domaine est déjà dans l'allowlist ;
//     allkpop, lui, est derrière Cloudflare et répond 403 à tout robot.
//   · les titres coréens DÉJÀ dans veille/AAAA-MM-JJ.md, qui ne coûtent rien à
//     relire.
//
// CE QUE CE MODULE NE FAIT PAS : chercher. Il rend des noms ; c'est la session
// Gemini qui cherche, avec la consigne de prompts/recherche-methode-coreen.md.
// Tout ce qui touche au réseau reçoit son `fetch`, comme guards.mjs.

import { ENTÊTES } from './guards.mjs';
import { analyserFlux, récents } from './veille.mjs';

/**
 * Les flux où se lisent les sorties.
 *
 * Un seul, et c'est déjà beaucoup : soixante titres par jour, dont cinq ou six
 * portent une sortie. Le 19 septembre 2026 : RESCENE (date de comeback), PLAVE
 * (photos concept), ZEROBASEONE (liste des titres) — et RESCENE avait bien un
 * pop-up dans l'onglet ce matin-là, ce qui vérifie l'hypothèse sur la donnée.
 */
export const FLUX_SORTIES = [{ source_name: 'Soompi', url: 'https://www.soompi.com/feed' }];

/** Trois semaines de surveillance : le délai sortie → pop-up, plus la marge. */
export const FENÊTRE_JOURS = 21;

/** Au plus tant de noms dans la consigne : une requête chacun, pas plus. */
export const MAX_SURVEILLÉES = 6;

/**
 * Tout ce que le flux garde, et non les trente heures de la veille.
 *
 * La veille dit « paru depuis » et se limite donc à la nuit ; cette liste-ci ne
 * parle pas d'actualité, elle parle d'une FENÊTRE DE SORTIE qui dure trois
 * semaines. Se limiter à trente heures écartait ZEROBASEONE et PLAVE le
 * 19 septembre 2026, repérés la veille par le même flux, pour rien : le flux
 * n'en tient que trois jours de toute façon, et la liste, elle, périme
 * toute seule.
 */
export const HEURES_DE_FLUX = 24 * 7;

// --- Reconnaître une sortie ---------------------------------------------------

/**
 * Ce qui fait d'un titre l'annonce d'une sortie.
 *
 * `debut` et `album` SEULS n'y sont pas, et c'est délibéré : « IU Makes
 * Generous Donations On Her 18th Debut Anniversary » n'est pas une sortie, et
 * « unveils » seul non plus (« Dasom Signs With New Agency + Unveils New
 * Profile Photos »). Un mot trop large coûte une requête par matin à Gemini,
 * pour rien.
 */
const SORTIE_EN = /\bcomeback\b|\breturns? with\b|\bto return\b|\breleases?\b|\breleased\b|\bdrops?\b|\bnew (?:single|album|ep|mini ?album|mixtape)\b|\btrack list\b|\bworld tour\b|\btour\b|\bfan ?meeting\b|\bfan ?sign\b|\bpop-?up\b|\bconcert\b/i;

/** Là où le nom s'arrête : le verbe de l'annonce. */
const VERBE_EN = /\b(?:announces?|announced|confirms?|unveils?|reveals?|shares?|drops?|releases?|released|returns?|sets?|teases?|to\s+(?:return|release|hold|drop)|is|are|will|makes?|holds?|opens?)\b/i;

/** Les mêmes, en coréen, tels que les rédactions les écrivent. */
const SORTIE_KO = /컴백|신곡|발매|팬미팅|콘서트|앨범|내한|팝업|단독 공연/;

/** Ce qu'on retire en tête d'un titre avant de lire le nom. */
const PRÉFIXES = /^(?:update|watch|breaking|exclusive|photos?|video|listen|just in)\s*:\s*|^\[[^\]]{1,24}\]\s*/i;

/** Un nom ne contient pas de guillemets : ce serait le titre d'une œuvre. */
const GUILLEMETS = /["“”'‘’「」『』《》]/;

/** Ni un mot de rédaction. */
const PAS_UN_NOM = /^(?:the|a|an|this|these|new|watch|update|korean|k-?pop|netflix|disney|fans?|사진|영상|속보|연합뉴스|기자)$/i;

/**
 * Le nom que porte un titre, s'il annonce une sortie.
 *
 * Le nom est ce qui PRÉCÈDE le verbe de l'annonce : « RESCENE Announces
 * Comeback Date » → RESCENE ; « Update: PLAVE Shares Concept Photos For
 * “HYPERDRIVE” Comeback » → PLAVE. En coréen, c'est ce qui précède la première
 * virgule : « 블랙핑크 지수, 9월 4일 솔로 컴백 » → 블랙핑크 지수.
 *
 * On ne cherche pas à isoler la personne du groupe : « BLACKPINK's Jisoo »
 * reste tel quel, l'apostrophe en moins. C'est une requête, pas une fiche
 * d'état civil, et « BLACKPINK Jisoo 팝업 » trouve ce que « 지수 팝업 » trouve.
 *
 * @param {string} titre
 * @returns {{nom: string, signal: string}|null}
 */
export function nomDuTitre(titre) {
  const propre = String(titre ?? '').replace(PRÉFIXES, '').trim();
  if (!propre) return null;

  const coréen = /[가-힣]/.test(propre);
  const sortie = coréen ? SORTIE_KO.exec(propre) : SORTIE_EN.exec(propre);
  if (!sortie) return null;

  let nom;
  if (coréen) {
    // Avant la première virgule ; sans virgule, avant le mot de la sortie.
    const virgule = propre.indexOf(',');
    nom = (virgule > 0 ? propre.slice(0, virgule) : propre.slice(0, sortie.index)).trim();
  } else {
    const verbe = VERBE_EN.exec(propre);
    nom = (verbe && verbe.index > 0 ? propre.slice(0, verbe.index) : propre.slice(0, sortie.index)).trim();
  }

  nom = nom.replace(/['’]s\b/gi, '').replace(/[·,:;–—-]+$/, '').replace(/\s+/g, ' ').trim();
  if (!nom || GUILLEMETS.test(nom)) return null;
  if (nom.length < 2 || nom.length > 40) return null;
  const mots = nom.split(' ');
  if (mots.length > 5) return null;
  if (mots.every((m) => PAS_UN_NOM.test(m))) return null;
  if (!/[A-Za-z가-힣]/.test(nom)) return null;

  return { nom, signal: sortie[0].toLowerCase() };
}

/** Les titres d'un flux RSS, parus depuis `heures`. */
export function titresDuFlux(xml, { maintenant = new Date(), heures = HEURES_DE_FLUX } = {}) {
  return récents(analyserFlux(xml), { maintenant, heures }).map((e) => e.title);
}

/**
 * Les titres des rédactions déjà présents dans la veille du matin.
 *
 * Seulement les lignes de flux (`- <ISO> · <titre>`), pas les résumés français
 * du site : ceux-là sont déjà couverts, et un titre français ne porte pas les
 * mots d'une annonce coréenne.
 */
export function titresDeLaVeille(texte) {
  return [...String(texte ?? '').matchAll(/^- \d{4}-\d{2}-\d{2}T[0-9:+-]+ · (.+)$/gm)].map((m) => m[1].trim());
}

/** Les noms d'une liste de titres, dédoublonnés, dans l'ordre d'apparition. */
export function repérer(titres, { source = '' } = {}) {
  const vus = new Set();
  const noms = [];
  for (const titre of titres) {
    const trouvé = nomDuTitre(titre);
    if (!trouvé) continue;
    const clé = trouvé.nom.toLowerCase().replace(/\s+/g, '');
    if (vus.has(clé)) continue;
    vus.add(clé);
    noms.push({ ...trouvé, source, titre });
  }
  return noms;
}

// --- La liste qui dure ---------------------------------------------------------

/**
 * Les noms surveillés, d'hier et d'aujourd'hui, les périmés en moins.
 *
 * EXPIRÉS PAR LEUR DATE, jamais par l'âge du fichier : le fichier est réécrit
 * chaque matin (veille/ est nettoyé à sept jours par date de modification), et
 * un nom vu il y a vingt jours doit sortir de la liste même si le fichier, lui,
 * date de ce matin.
 *
 * `vu` est la première fois, `revu` la dernière : un artiste qui reste dans
 * l'actualité reste surveillé, et c'est `revu` qui fait courir les trois
 * semaines.
 *
 * @param {object[]} anciennes
 * @param {object[]} nouvelles
 * @param {{jour: string, fenêtreJours?: number}} p
 */
export function fusionner(anciennes = [], nouvelles = [], { jour, fenêtreJours = FENÊTRE_JOURS }) {
  const limite = new Date(`${jour}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - fenêtreJours);
  const plancher = limite.toISOString().slice(0, 10);

  const par = new Map();
  for (const e of anciennes) {
    if (!e?.nom) continue;
    par.set(e.nom.toLowerCase().replace(/\s+/g, ''), { ...e });
  }
  for (const { nom, signal, source } of nouvelles) {
    const clé = nom.toLowerCase().replace(/\s+/g, '');
    const déjà = par.get(clé);
    if (déjà) par.set(clé, { ...déjà, signal, source, revu: jour });
    else par.set(clé, { nom, signal, source, vu: jour, revu: jour });
  }

  // D'abord les revus le plus récemment, puis — à égalité — les sorties les
  // PLUS ANCIENNES. Ce n'est pas une coquetterie de tri : le pop-up vient une à
  // trois semaines après la sortie, donc un nom repéré il y a dix jours est
  // plus mûr qu'un nom repéré ce matin, et c'est lui qu'il faut chercher
  // d'abord quand le plafond ne laisse passer que six requêtes.
  return [...par.values()]
    .filter((e) => (e.revu ?? e.vu ?? '') >= plancher)
    .sort((a, b) => (b.revu ?? '').localeCompare(a.revu ?? '') || (a.vu ?? '').localeCompare(b.vu ?? ''));
}

/**
 * La liste, telle que la consigne la porte.
 *
 * Les plus fraîches d'abord, `max` au plus : une requête chacune, et une
 * session qui en ferait douze n'aurait plus de budget pour le coréen.
 */
export function rendreSurveillées(liste = [], { max = MAX_SURVEILLÉES } = {}) {
  if (!liste.length) return '(rien de neuf : aucune sortie repérée ces trois dernières semaines)';
  return liste
    .slice(0, max)
    .map(({ nom, signal, vu, source }) => `- ${nom} — ${signal}, repéré le ${vu}${source ? ` (${source})` : ''}`)
    .join('\n');
}

/**
 * Le relevé du matin : les flux, la veille, puis la fusion avec la liste
 * d'hier.
 *
 * Un flux en panne est un flux en moins ; la liste d'hier suffit à faire une
 * consigne, et c'est justement à quoi elle sert.
 */
export async function relever({
  anciennes = [],
  veille = '',
  jour,
  flux = FLUX_SORTIES,
  fetcher = fetch,
  timeoutMs = 10_000,
  maintenant = new Date(),
} = {}) {
  const nouvelles = [];
  const pannes = [];

  for (const { source_name, url } of flux) {
    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { headers: ENTÊTES, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      nouvelles.push(...repérer(titresDuFlux(await res.text(), { maintenant }), { source: source_name }));
    } catch (e) {
      pannes.push(`${source_name} : ${e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message}`);
    } finally {
      clearTimeout(minuteur);
    }
  }

  nouvelles.push(...repérer(titresDeLaVeille(veille), { source: 'veille' }));

  return { surveillées: fusionner(anciennes, nouvelles, { jour }), pannes };
}
