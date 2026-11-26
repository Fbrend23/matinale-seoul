// Les pages des sources, téléchargées par le dépôt et mises dans la consigne.
//
// POURQUOI. La relecture demandait à Gemini d'ouvrir les sources lui-même.
// Le 26 novembre 2026, les traces d'`agy` ont montré qu'il n'en ouvrait plus
// aucune depuis la parution du 21 octobre : l'outil de lecture d'adresses
// n'est plus transmis au modèle, la session rend SUCCESS, et le rapport disait
// « sans changement » d'un brief que personne n'avait confronté à rien. Ce
// que le dépôt télécharge, il sait qu'il l'a fourni ; ce qu'il n'a pas pu
// lire, il le sait aussi, et le rapport le dit.
//
// UNE PAGE ILLISIBLE EST UNE PAGE ILLISIBLE. Refus, erreur, page
// « introuvable » servie en 200, page d'accueil, texte rendu par JavaScript :
// aucune ne prouve quoi que ce soit, ni pour ni contre le résumé. Mieux vaut
// la compter comme non relue que laisser un modèle juger sur un menu.
//
// Le robot se nomme (ENTÊTES, dans lib/guards.mjs) : un site qui le refuse
// reste non relu.

import { ENTÊTES } from './guards.mjs';

/** En dessous, ce n'est pas un article : un menu, une coquille JavaScript. */
export const MIN_CARACTÈRES = 400;

/** Au-delà d'une page de cette taille, on ne lit pas plus loin. */
const MAX_OCTETS_TÉLÉCHARGÉS = 3_000_000;

/**
 * Le titre d'une page d'erreur servie en 200. Cherché dans les titres, et en
 * tête de texte quand la page est courte : « page not found » au milieu d'un
 * article est un sujet, pas une erreur. Le 26 novembre 2026, Yonhap servait
 * « 원하시는 페이지를 찾을 수 없습니다 » avec un code 200.
 */
const INTROUVABLE = /페이지를 찾을 수 없|존재하지 않는 페이지|페이지가 존재하지 않|page not found|404 not found|page introuvable/i;

const ENTITÉS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function décoder(texte) {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e) => {
    if (e[0] !== '#') return ENTITÉS[e.toLowerCase()] ?? tout;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tout;
  });
}

/** Le texte nu d'un fragment de HTML, un bloc par ligne. */
function texteDe(html) {
  const nu = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|dd|dt|figure|figcaption|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return décoder(nu)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** La valeur d'une balise `<meta>`, quel que soit l'ordre de ses attributs. */
function méta(html, nom) {
  for (const [balise] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const clé = /\b(?:property|name|itemprop)\s*=\s*(["'])(.*?)\1/i.exec(balise)?.[2];
    if (clé?.toLowerCase() !== nom) continue;
    const valeur = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(balise)?.[2];
    if (valeur) return décoder(valeur).trim();
  }
  return null;
}

/** Les objets JSON-LD de la page, à plat, `@graph` compris. */
function jsonLd(html) {
  const objets = [];
  const parcourir = (o) => {
    if (Array.isArray(o)) return o.forEach(parcourir);
    if (!o || typeof o !== 'object') return;
    objets.push(o);
    if (o['@graph']) parcourir(o['@graph']);
  };
  for (const [, corps] of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      parcourir(JSON.parse(corps.trim()));
    } catch {
      // Un JSON-LD cassé est un JSON-LD en moins : le texte de la page reste.
    }
  }
  return objets;
}

/**
 * Ce qu'une page dit : son titre, sa date de publication, son texte.
 *
 * Le texte vient de l'`articleBody` du JSON-LD quand il y en a un, sinon de
 * la page entière débarrassée de ses menus. Pas du premier `<article>` : une
 * page de presse en porte vingt, un par renvoi.
 *
 * @param {string} html
 * @returns {{ titre: string|null, publié: string|null, texte: string }}
 */
export function extrairePage(html) {
  const ld = jsonLd(html);
  const champ = (nom) => ld.map((o) => o[nom]).find((v) => typeof v === 'string' && v.trim()) ?? null;
  const baliseTitre = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const titre = méta(html, 'og:title') ?? (champ('headline') && décoder(champ('headline'))) ?? (baliseTitre ? texteDe(baliseTitre) : null);
  const publié = méta(html, 'article:published_time') ?? champ('datePublished') ?? méta(html, 'datepublished');

  const corpsLd = ld.map((o) => o.articleBody).filter((v) => typeof v === 'string').sort((a, b) => b.length - a.length)[0];
  let texte = corpsLd ? texteDe(corpsLd) : '';
  if (texte.length < MIN_CARACTÈRES) {
    const sansMenus = html
      .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form|select)\b[\s\S]*?<\/\1\s*>/gi, ' ');
    texte = texteDe(sansMenus);
  }
  return { titre: titre?.trim() || null, publié: publié?.trim() || null, texte };
}

const estAccueil = (adresse) => {
  try {
    const u = new URL(adresse);
    return /^\/(index\.[a-z]+)?$/i.test(u.pathname) && !u.search;
  } catch {
    return false;
  }
};

/** L'encodage annoncé, par l'en-tête puis par la page : des sites coréens sont encore en EUC-KR. */
function déchiffrer(octets, type = '') {
  const annoncé = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1]
    ?? /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(octets.subarray(0, 4096).toString('latin1'))?.[1]
    ?? 'utf-8';
  try {
    return new TextDecoder(annoncé).decode(octets);
  } catch {
    return new TextDecoder('utf-8').decode(octets);
  }
}

/**
 * Une source, téléchargée et jugée lisible ou non. Ne lève jamais.
 *
 * @param {string} url
 * @param {{ fetcher?: typeof fetch, timeoutMs?: number }} [p]
 * @returns {Promise<{ url: string, lisible: boolean, raison?: string, titre?: string|null, publié?: string|null, texte?: string }>}
 */
export async function lirePage(url, { fetcher = fetch, timeoutMs = 20_000 } = {}) {
  const illisible = (raison) => ({ url, lisible: false, raison });
  if (estAccueil(url)) return illisible('page d\'accueil, pas la page du sujet');
  try {
    const res = await fetcher(url, { headers: ENTÊTES, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return illisible(`HTTP ${res.status}`);
    if (res.url && estAccueil(res.url)) return illisible('renvoie vers la page d\'accueil');
    const type = res.headers?.get('content-type') ?? '';
    if (type && !/html|text\/plain|xml/i.test(type)) return illisible(`contenu non lu : ${type.split(';')[0]}`);
    const octets = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_OCTETS_TÉLÉCHARGÉS);
    const { titre, publié, texte } = extrairePage(déchiffrer(octets, type));
    if (INTROUVABLE.test(titre ?? '') || (texte.length < 3000 && INTROUVABLE.test(texte))) return illisible('page « introuvable » servie en succès');
    if (texte.length < MIN_CARACTÈRES) return illisible(`texte trop court (${texte.length} caractères), page vide ou rendue par JavaScript`);
    return { url, lisible: true, titre, publié, texte };
  } catch (e) {
    return illisible(e.name === 'TimeoutError' ? 'pas de réponse à temps' : `injoignable : ${e.cause?.code ?? e.message}`);
  }
}

/**
 * Plusieurs sources, chacune une fois, quelques-unes de front.
 *
 * @param {string[]} adresses
 * @param {{ fetcher?: typeof fetch, timeoutMs?: number, concurrence?: number }} [p]
 * @returns {Promise<Map<string, Awaited<ReturnType<typeof lirePage>>>>}
 */
export async function lirePages(adresses, { concurrence = 4, ...options } = {}) {
  const file = [...new Set(adresses)];
  const pages = new Map();
  let prochain = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrence, file.length) }, async () => {
      for (let i = prochain++; i < file.length; i = prochain++) pages.set(file[i], await lirePage(file[i], options));
    })
  );
  return pages;
}

/**
 * Au plus `octets` octets d'UTF-8, sans couper un caractère. En octets et non
 * en caractères : la consigne part en argument de commande, que Linux compte
 * ainsi, et le coréen en prend trois par signe.
 */
export function tronquer(texte, octets) {
  const tampon = Buffer.from(texte, 'utf8');
  if (tampon.length <= octets) return { texte, tronqué: false };
  let fin = Math.max(0, octets);
  while (fin > 0 && (tampon[fin] & 0xc0) === 0x80) fin--;
  return { texte: tampon.subarray(0, fin).toString('utf8'), tronqué: true };
}
