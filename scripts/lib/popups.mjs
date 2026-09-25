// LE REGISTRE DES POP-UPS : ÉNUMÉRER AU LIEU DE CHERCHER.
//
// POURQUOI. La recherche du matin (scripts/recherche.mjs) est un
// ÉCHANTILLON : deux sessions Gemini, une dizaine de minutes, une
// cinquantaine d'appels, puis MAX_PAR_SOURCE qui n'en garde que trois par
// domaine. Un modèle qui cherche ne garantit jamais la couverture, et ça se
// mesurait dans l'onglet : le 19 septembre 2026, insideseoul.app tenait
// soixante-cinq fiches de pop-ups en cours et l'onglet en connaissait les
// deux tiers, les absents étant presque tous des petites marques — celles
// dont aucune rédaction ne parle jamais.
//
// Or cette page-là n'a pas besoin d'un modèle. Elle liste ses fiches dans son
// HTML, et chaque fiche porte un JSON-LD `Event` complet : nom, dates,
// ADRESSE EN HANGUL (le champ même que le test du hangul réclame), géo, prix.
// Énumérer l'index puis lire les fiches, c'est cent pour cent du registre,
// sans quota, sans modèle, et sans rien à deviner. Ce que Gemini peut faire
// et qu'un script ne peut pas — chercher en coréen ce qu'aucune liste ne
// tient —, son budget y va entièrement (prompts/recherche-methode-pages.md).
//
// CE QUI RESTE AU RÉDACTEUR, et qu'on ne fabrique pas ici : le `name` en
// français (le registre écrit en anglais) et le `summary`. Un résumé traduit
// par substitution de mots serait un résumé que personne n'a lu ; la matière
// anglaise est donnée à côté de la fiche, et c'est le rédacteur qui écrit.
//
// PAS DE FILE D'ATTENTE À TENIR. Une piste non retenue ce matin n'est pas
// perdue : le registre se réénumère demain et la reproposera tant qu'elle
// n'est pas dans l'onglet. C'est la propriété qui distingue une énumération
// d'une recherche, et elle dispense d'un registre de candidats côté dépôt.
//
// Rien ici ne touche au réseau sans recevoir son `fetch`, comme guards.mjs et
// pour la même raison : testable sans réseau.

import { ENTÊTES } from './guards.mjs';
import { lieuEnCoréen } from './recherche.mjs';
import { périodesSeRecouvrent } from '../../shared/evenements.mjs';

/**
 * Les registres, décrits en donnée et non en code.
 *
 * Ce qu'ils ont en commun, et qui fait tout : un index qui cite ses fiches
 * dans son HTML, et une fiche qui porte un JSON-LD `Event`. Ce qui les
 * distingue tient en quatre lignes chacun — la forme de leurs adresses, et où
 * ils rangent le lieu.
 *
 * `fiche` : l'index d'Inside Seoul mêle ses fiches à ses guides et à ses pages
 * de quartier ; une fiche, c'est un quartier, `popups`, un slug, trois
 * segments et pas deux.
 *
 * `lieu` et `quartier` : c'est là qu'ils diffèrent vraiment. Inside Seoul
 * écrit son `location.name` EN HANGUL, adresse complète, ce que Naver Map
 * géocode et ce que le schéma demande. NOL World romanise tout — « Seoul
 * Plaza », « 108, Yeoui-daero, Yeongdeungpo-gu » —, et le hangul doit donc
 * venir d'ailleurs : de la table des salles (lieuEnCoréen), qui existait déjà
 * pour la même raison, les billetteries écrivant « KSPO DOME ». Ce qu'elle ne
 * connaît pas ressort « à compléter » dans la veille, avec l'adresse
 * romanisée : la garde du hangul l'écarterait, et l'écarter en silence serait
 * perdre un concert que personne d'autre n'annonce.
 */
export const INSIDE_SEOUL = {
  nom: 'Inside Seoul',
  hôte: 'insideseoul.app',
  index: 'https://insideseoul.app/popups',
  fiche: /^\/[a-z0-9-]+\/popups\/[a-z0-9-]+$/,
  lang: 'en',
  lieu: (objet) => objet.location?.name ?? objet.location?.address?.streetAddress ?? '',
  quartier: (objet, url) => quartierDeLAdresse(url),
};

export const NOL_WORLD = {
  nom: 'NOL World',
  hôte: 'world.nol.com',
  index: 'https://world.nol.com/en/regions/seoul/festas',
  fiche: /^\/en\/content\/festas\/[a-f0-9-]{20,}$/,
  lang: 'en',
  // Le nom du lieu quand il y en a un, passé par la table ; sinon l'adresse
  // romanisée. Ni l'un ni l'autre ne garantit du hangul, et c'est voulu : la
  // garde écarte, et scripts/popups.mjs range ce refus-là « à compléter »
  // plutôt que de le perdre. Huit des vingt-deux fiches datées de NOL World
  // n'ont pas de nom de lieu du tout, le 19 septembre 2026.
  lieu: (objet) => lieuEnCoréen(objet.location?.name?.trim() || objet.location?.address?.streetAddress || ''),
  quartier: (objet) => quartierRomanisé(objet.location?.address?.streetAddress ?? ''),
};

/**
 * NEMONE PACE, le troisième, et le seul qu'on ne CITE PAS.
 *
 * Il tient ce que les deux autres ne tiennent pas : les boutiques éphémères
 * de petites enseignes, que personne n'annonce. Le 25 septembre 2026, le
 * magasin de goodies Pokémon de Play in the Box au 연무장길 27, ouvert depuis
 * le 11 et jusqu'au 31 décembre, n'était ni chez Inside Seoul ni chez NOL
 * World, ni dans aucune rédaction — il était chez NEMONE.
 *
 * Mais ses fiches sont écrites par un modèle (« This content is AI-generated
 * from public information and may differ from actual facts », dit chacune) :
 * il est donc au rang des agrégateurs dans config/sources.json, et ce qu'il
 * rend sort dans la veille « à sourcer », jamais en JSON prêt à recopier.
 * `citable: false` le dit à scripts/popups.mjs.
 *
 * TROIS DIFFÉRENCES DE FORME. L'index est le sitemap, deux mille sept cents
 * fiches où les boutiques permanentes, les ateliers, les concerts et Jeju
 * côtoient les pop-ups : `écarter` ne garde que ce que la fiche dit elle-même
 * être un pop-up ou une exposition à Séoul (la troisième réponse de sa FAQ,
 * « It's a Pop-up in SEONGSU. »). Une boutique permanente y porte des dates
 * fictives, aujourd'hui → aujourd'hui, et la FAQ le trahit (« open
 * year-round »). Et relire deux mille sept cents fiches chaque matin serait
 * vingt minutes : `mémoire` dit au script de se souvenir de ce qu'il a écarté.
 *
 * La version anglaise d'abord, quand le sitemap en donne une : le diff contre
 * l'onglet compare des mots, et l'onglet ne parle pas coréen. Le lieu reste
 * en hangul dans les deux langues.
 */
export const NEMONE = {
  nom: 'NEMONE PACE',
  hôte: 'now.nemoneai.com',
  index: 'https://now.nemoneai.com/sitemap.xml',
  fiche: /^\/posts\/\d+$/,
  lang: 'en',
  citable: false,
  mémoire: true,
  // Une fiche à la fois : à quatre de front, il répond 429 après quatre cents
  // fiches (le 25 septembre 2026) ; seul, cent cinquante passent d'affilée.
  concurrence: 1,
  // Au plus tant de fiches par matin, les plus récentes d'abord : un matin
  // normal en relit cent cinquante, mais la mémoire perdue en ferait relire
  // deux mille sept cents, une heure de retard pour le brief. Plafonnée, elle
  // se refait en dix matins de sept minutes.
  plafond: 300,
  adresses: (xml) =>
    fichesDuPlan(xml, { hôte: 'now.nemoneai.com', fiche: /^\/posts\/\d+$/ }).sort(
      (a, b) => Number(b.match(/\/posts\/(\d+)/)[1]) - Number(a.match(/\/posts\/(\d+)/)[1])
    ),
  écarter: (html) => {
    const { genre, zone, permanent } = faqNemone(html);
    if (permanent) return 'sans date de fin annoncée';
    if (!genre || !zone) return 'fiche sans catégorie';
    if (!ZONES_NEMONE[zone]) return 'hors de Séoul';
    if (!GENRES_NEMONE.has(genre)) return 'ni pop-up ni exposition';
    return null;
  },
  lieu: (objet) => objet.location?.name ?? objet.location?.address?.streetAddress ?? '',
  quartier: (objet, url, html) => ZONES_NEMONE[faqNemone(html).zone] ?? 'Seoul',
};

/** Les zones de NEMONE, et ce qu'on affiche : Busan et Jeju n'y sont pas. */
const ZONES_NEMONE = { seongsu: 'Seongsu', hongdae: 'Hongdae', gangbuk: 'Gangbuk', gangnam: 'Gangnam' };
const ZONES_CORÉENNES = { 성수: 'seongsu', 홍대: 'hongdae', 강북: 'gangbuk', 강남: 'gangnam', 부산: 'busan', 제주: 'jeju' };
/** Ses catégories (Pop-up, Class, Shopping, Exhibit, Event) : les deux qui en sont. */
const GENRES_NEMONE = new Set(['pop-up', 'exhibit', '팝업', '전시']);

/**
 * Ce que la FAQ d'une fiche NEMONE dit d'elle : sa catégorie, sa zone, et si
 * elle est permanente. Rien d'autre sur la page ne le dit en clair — le
 * JSON-LD donne aux boutiques permanentes des dates du jour.
 *
 * @param {string} html
 * @returns {{genre: string|null, zone: string|null, permanent: boolean}}
 */
export function faqNemone(html) {
  const réponses = [];
  for (const bloc of blocsLd(html)) {
    if (bloc?.['@type'] !== 'FAQPage') continue;
    for (const q of bloc.mainEntity ?? []) réponses.push(String(q?.acceptedAnswer?.text ?? ''));
  }
  const permanent = réponses.some((r) => /year-round|상시 운영/i.test(r));
  for (const r of réponses) {
    const en = r.match(/^It's an? (.+?) in ([A-Za-z]+)\.$/);
    if (en) return { genre: en[1].toLowerCase(), zone: en[2].toLowerCase(), permanent };
    const ko = r.match(/^(\S+) 지역의 (\S+)입니다\.?$/);
    if (ko) return { genre: ko[2], zone: ZONES_CORÉENNES[ko[1]] ?? ko[1], permanent };
  }
  return { genre: null, zone: null, permanent };
}

/**
 * Les fiches d'un sitemap : la version anglaise quand il la déclare, sinon
 * l'adresse elle-même (les fiches les plus récentes n'ont pas encore la leur).
 *
 * @param {string} xml
 * @param {{hôte: string, fiche: RegExp}} p
 * @returns {string[]}
 */
export function fichesDuPlan(xml, { hôte, fiche }) {
  const vues = new Set();
  const adresses = [];
  for (const [, bloc] of String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = bloc.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    let u;
    try {
      u = new URL(loc);
    } catch {
      continue;
    }
    if (u.host !== hôte || !fiche.test(u.pathname)) continue;
    const anglaise = bloc.match(/hreflang=["']en["'][^>]*href=["']([^"']+)["']/)?.[1];
    const adresse = anglaise ?? loc;
    if (vues.has(adresse)) continue;
    vues.add(adresse);
    adresses.push(adresse);
  }
  return adresses;
}

/**
 * L'ordre compte un peu : le premier registre qui donne un événement le garde,
 * et Inside Seoul rend le hangul sans intermédiaire. NOL World couvre ce qu'il
 * ne couvre pas — les concerts, les expositions à billet, les pop-ups d'idols.
 * NEMONE vient en dernier : ce qu'un registre citable rend, on ne le lui
 * demande pas.
 */
export const REGISTRES = [INSIDE_SEOUL, NOL_WORLD, NEMONE];

/** Le premier registre, pour les appels qui n'en nomment aucun. */
export const REGISTRE = INSIDE_SEOUL;

/** Au plus tant de fiches de front : elles partent toutes vers le même site. */
export const CONCURRENCE = 4;

/**
 * Combien de fiches du registre la veille met en avant pour le brief.
 *
 * Le registre en rend trente ou quarante, et le brief du matin en publie
 * trois ou quatre : tout déverser dans la veille ferait une section que
 * personne ne lit. Les mises en avant sont les plus proches d'aujourd'hui,
 * le reste est listé d'une ligne chacun — visible, et pas au travers.
 */
export const MISES_EN_AVANT = 5;

/** Et combien de fiches « à sourcer » : chacune coûte une recherche. */
export const À_SOURCER_MAX = 12;

// --- Lecture du registre -----------------------------------------------------

/**
 * Les adresses de fiches citées par une page d'index.
 *
 * Dans l'ordre d'apparition, dédoublonnées : l'index range ses fiches, et cet
 * ordre-là vaut mieux qu'aucun.
 *
 * @param {string} html
 * @param {object} [p]
 * @param {string} [p.base]        l'index, pour absolutiser
 * @param {RegExp} [p.fiche]
 * @returns {string[]}
 */
export function adressesDeFiches(html, { base = REGISTRE.index, fiche = REGISTRE.fiche } = {}) {
  const vues = new Set();
  const adresses = [];
  for (const [, chemin] of String(html).matchAll(/["'](\/[a-z0-9\-/]+)["'\\]/g)) {
    if (!fiche.test(chemin)) continue;
    let absolue;
    try {
      absolue = new URL(chemin, base).toString();
    } catch {
      continue;
    }
    if (vues.has(absolue)) continue;
    vues.add(absolue);
    adresses.push(absolue);
  }
  return adresses;
}

/** Les blocs JSON-LD d'une page, ceux qui s'analysent. */
function blocsLd(html) {
  const blocs = [];
  for (const [, contenu] of String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      blocs.push(JSON.parse(contenu));
    } catch {
      // Un bloc illisible n'est pas une panne de la page : les autres restent.
    }
  }
  return blocs;
}

/** Le premier objet `Event` d'un JSON-LD, tableaux et `@graph` compris. */
function objetÉvénement(blocs) {
  const pile = [...blocs];
  while (pile.length) {
    const o = pile.shift();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) pile.unshift(...o);
    else if (o['@type'] === 'Event') return o;
    else if (Array.isArray(o['@graph'])) pile.unshift(...o['@graph']);
  }
  return null;
}

/**
 * Le quartier, tiré du chemin de la fiche.
 *
 * `area` est AFFICHÉ, jamais cherché (schéma) : le segment de l'index, mis en
 * capitale, dit au lecteur où aller. L'adresse en hangul, elle, dira le reste
 * à Naver Map.
 */
export function quartierDeLAdresse(url) {
  try {
    const [quartier] = new URL(url).pathname.replace(/^\//, '').split('/');
    return quartier ? quartier.split('-').map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join('-') : null;
  } catch {
    return null;
  }
}

/**
 * Le quartier, tiré d'une adresse routière romanisée.
 *
 * « 108, Yeoui-daero, Yeongdeungpo-gu, » → « Yeongdeungpo ». `area` est
 * AFFICHÉ et romanisé par contrat (schéma), donc rien à traduire ici : c'est
 * le seul champ que l'adresse romanisée de NOL World remplit sans perte.
 */
export function quartierRomanisé(adresse) {
  const segments = String(adresse ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  const arrondissement = segments.find((m) => /-(gu|si)$/i.test(m));
  if (arrondissement) return arrondissement.replace(/-(gu|si)$/i, '');
  const dernier = segments.at(-1);
  return dernier && !/^\d/.test(dernier) ? dernier : null;
}

/**
 * L'événement d'une fiche, tel que son JSON-LD le donne.
 *
 * LES DATES SONT DES JOURS, PAS DES INSTANTS. Le registre écrit
 * « 2026-09-19T00:00:00.000Z » pour un pop-up ouvert le 19 à Séoul : minuit
 * UTC y est le marqueur d'une journée locale, pas une heure. On garde donc
 * les dix premiers caractères et on ne convertit RIEN — convertir reculerait
 * chaque date d'un jour (la fiche DALSOM, « 19 to 20 September » en toutes
 * lettres dans sa description, l'a montré).
 *
 * `summary` est ABSENT du retour : il se rédige en français, à partir de
 * `matière`, et un résumé anglais recopié tel quel serait un résumé que
 * personne n'a écrit.
 *
 * Rien à en tirer : `{ raison }`, en clair. « Pas de JSON-LD » et « pas de date
 * de fin » ne se corrigent pas au même endroit, et vingt fiches de NOL World
 * rangées sous le même message disaient le contraire de la vérité.
 *
 * @param {string} html
 * @param {object} p
 * @param {string} p.url
 * @param {object} [p.registre]
 * @returns {{event: object, matière: string, adresse: string}|{raison: string, règle?: boolean}}
 */
export function événementDeFiche(html, { url, registre = REGISTRE }) {
  const objet = objetÉvénement(blocsLd(html));
  if (!objet) return { raison: 'pas de JSON-LD Event' };

  // Ce que le registre sait écarter de lui-même, avant les dates : les
  // boutiques permanentes de NEMONE portent des dates, fausses.
  const refus = registre.écarter?.(html, objet);
  if (refus) return { raison: refus, règle: true };

  const nom = typeof objet.name === 'string' ? objet.name.trim() : '';
  const début = typeof objet.startDate === 'string' ? objet.startDate.slice(0, 10) : '';
  const fin = typeof objet.endDate === 'string' ? objet.endDate.slice(0, 10) : '';
  if (!nom) return { raison: 'fiche sans nom' };
  // Vingt des quarante-deux fiches de NOL World n'ont pas de date de fin, le
  // 19 septembre 2026. C'est la règle du prompt, pas un accident de lecture :
  // sans date de fin annoncée, il n'y a pas d'événement. `règle` le dit, pour
  // que le journal compte ces fiches au lieu de les crier une par une.
  if (!début || !fin) return { raison: 'sans date de fin annoncée', règle: true };

  // Le lieu : chaque registre sait où il le range, et dans quelle langue (voir
  // REGISTRES). Ce qui en sort n'est pas garanti en hangul — c'est la garde qui
  // tranche, et scripts/popups.mjs range à part ce qu'elle refuse pour ce
  // seul motif, au lieu de le perdre.
  const venue = String(registre.lieu?.(objet, url) ?? '').trim();
  if (!venue) return { raison: 'sans lieu ni adresse', règle: true };

  const matière = typeof objet.description === 'string' ? objet.description.trim() : '';

  const event = {
    name: nom,
    kind: genreProbable(nom),
    venue,
    area: registre.quartier?.(objet, url, html) ?? 'Seoul',
    start_date: début,
    end_date: fin,
    source_name: registre.nom,
    source_url: url,
    source_lang: registre.lang,
  };
  const theme = thèmeProbable(nom, matière);
  if (theme) event.theme = theme;
  // L'adresse telle que le registre l'écrit, même romanisée : elle ne va pas
  // dans l'événement (le champ `address` du schéma veut du hangul), mais c'est
  // de quoi retrouver le lieu sur Naver Map quand le nom manque.
  const adresse = String(objet.location?.address?.streetAddress ?? '').trim();
  return { event, matière, adresse };
}

// --- Ce qu'un mot-clé peut dire, et ce qu'il ne peut pas ---------------------

/**
 * Le genre, DU NOM SEUL.
 *
 * L'index ne liste que des pop-ups au sens large : ce qui n'en est pas se
 * reconnaît à un mot de son titre, et `popup` est le défaut honnête. La
 * description, elle, parle de ce qu'on y trouve — « des produits du concert »
 * ferait un concert d'un pop-up de marchandise.
 */
export function genreProbable(texte = '') {
  const t = String(texte).toLowerCase();
  if (/\bexhibition|retrospective|museum\b|전시/.test(t)) return 'exposition';
  // « fest\b » attrape l'Oktoberfest, que « festival » laissait passer pour un
  // pop-up ; il ne prend pas « festivalier », qui ne titre rien.
  if (/festival|fest\b|feast\b|축제/.test(t)) return 'festival';
  if (/\bconcert|fan ?meeting|fan ?sign|live show\b/.test(t)) return 'concert';
  if (/\b(trade )?fair|expo 20|salon\b/.test(t)) return 'salon';
  return 'popup';
}

/**
 * Le thème, PROPOSÉ et non tranché.
 *
 * Un mot-clé ne sait pas où passe la frontière : « ATEEZ × LINE FRIENDS » est
 * du `kpop` par sa tête d'affiche et du `personnages` par sa marchandise, et
 * c'est le prompt qui arbitre (schéma, description de `theme`). L'ordre des
 * règles porte donc les arbitrages qu'on connaît — l'idol passe devant le
 * personnage, le café d'anime devant le café —, et le rédacteur garde le
 * dernier mot, la veille le lui dit.
 *
 * Rien trouvé : `null`, et le champ est omis. Un thème faux coûte plus qu'un
 * thème à trancher.
 *
 * DEUX PORTÉES, et c'est ce qui fait la différence entre une proposition utile
 * et du bruit. Un nom d'artiste ou de personnage ne compte que dans le TITRE :
 * cité dans la description, il n'est qu'un détail, et le premier essai a
 * classé « Takao Mountain Book Pop-up » en `kpop` parce qu'une description
 * parlait d'un sanctuaire — « sa-NCT-uary ». Les mots qui disent la NATURE de
 * l'événement (exposition, café, parfum) comptent, eux, partout.
 */
export function thèmeProbable(nom = '', matière = '') {
  const titre = String(nom).toLowerCase();
  const tout = `${titre} ${String(matière).toLowerCase()}`;
  // [thème, motif, ce qu'il lit]. L'ordre porte les arbitrages connus.
  const règles = [
    ['pokemon', /pok[eé]mon|pikachu|포켓몬/, tout],
    ['kpop', /\bk-?pop\b|\bidol|fan ?meeting|fan ?sign|kwangya|weverse|아이돌|팬미팅/, tout],
    ['kpop', /\bateez\b|\bblackpink\b|\bjisoo\b|\bbts\b|\bnct\b|\bseventeen\b|stray kids|\baespa\b|\bive\b|\benhypen\b|\btxt\b|\bizna\b|\brescene\b|\bhybe\b/, titre],
    ['anime', /anime|manga|animate|collab cafe|jujutsu|attack on titan|blue lock|bleach|fate\/|gundam|ghibli|one piece|demon slayer|sailor moon|애니|콜라보 카페/, tout],
    ['personnages', /sanrio|hello kitty|chiikawa|miffy|line friends|kakao friends|pop ?mart|labubu|sonny angel|smiski|snoopy|esther bunny|캐릭터|산리오/, titre],
    ['gaming', /\bgames?\b|gaming|\btcg\b|league of legends|riftbound|e-?sports?|pubg|nexon|krafton|playstation|nintendo|arcade|게임/, tout],
    ['sport', /football|soccer|k league|\bkbo\b|baseball|marathon|\brunning\b|basketball|adidas|\bnike\b|축구|야구|마라톤/, tout],
    ['food', /caf[eé]|bakery|tteok|dessert|coffee|\bbeer\b|brewery|restaurant|ice cream|rice cake|떡|카페|맥주/, tout],
    ['mode', /\bfw2\d|\bss2\d|collection|fashion|beauty|fragrance|perfume|scent|sneaker|streetwear|cosmetic|skincare|activewear|jewel|패션|뷰티/, tout],
    ['culture', /exhibition|museum|gallery|\bart\b|photo|design|\bbook|stationery|ceramic|heritage|전시|미술관/, tout],
    ['seoul', /palace|hangang|han river|lantern|firework|festival|궁|한강|축제/, tout],
  ];
  for (const [thème, motif, où] of règles) if (motif.test(où)) return thème;
  return null;
}

// --- Le diff contre l'onglet -------------------------------------------------

/**
 * Les mots d'un nom qui DÉSIGNENT quelque chose.
 *
 * Le nom du registre est en anglais et celui de l'onglet en français : « Pop-up
 * LE BOISÉ Fragrance au DDP » et « LE BOISÉ Fragrance Pop-up (DDP,
 * Dongdaemun) » ne se ressemblent par aucune mesure de chaîne, et pourtant ils
 * partagent ce qui compte, la marque. Restent donc les mots qui ne sont ni de
 * la plomberie de titre (pop, up, store, first, only), ni un quartier, ni une
 * enseigne — ceux-là reviennent dans dix noms par semaine.
 *
 * Les accents tombent (« BOISÉ » contre « boise »), le hangul reste.
 */
const BANALITÉS = new Set([
  'pop', 'ups', 'popup', 'popups', 'store', 'stores', 'shop', 'seoul', 'the', 'and', 'for', 'with', 'its',
  'first', 'new', 'open', 'opening', 'official', 'collab', 'cafe', 'market', 'flea', 'limited', 'only',
  'one', 'day', 'days', 'weekend', 'week', 'launch', 'anniversary', 'edition', 'special', 'exclusive',
  'autumn', 'winter', 'spring', 'summer', 'night', 'pour', 'chez', 'dans', 'les', 'des', 'une', 'avec',
  'aux', 'sur', 'son', 'sa', 'ses',
  // Quartiers et enseignes : un lieu n'a jamais désigné un événement.
  'seongsu', 'hongdae', 'gangnam', 'sinsa', 'jamsil', 'myeongdong', 'yeouido', 'mapo', 'hannam', 'dosan',
  'samseong', 'euljiro', 'yongsan', 'sindang', 'huam', 'dongdaemun', 'bukchon', 'apgujeong', 'ikseon',
  'seochon', 'jung', 'gwanghwamun', 'times', 'square', 'plaza', 'mall', 'tower', 'park', 'station',
  'floor', 'hyundai', 'musinsa', 'shinsegae', 'lotte', 'coex', 'ddp', 'ipark', 'gallery',
  // Les enseignes qui ACCUEILLENT, et dont le nom revient donc sur dix
  // événements sans rien dire d'aucun : « Gratte », le café collaboratif
  // d'animate, en héberge un nouveau toutes les deux semaines.
  'animate', 'gratte', 'figurepresso', 'mofun', 'storykan', 'megastore', 'flagship', 'outlets',
  'department',
  // Noms communs qui ont chacun fait un faux doublon au premier essai :
  // « Horror House » contre « ENHYPEN House of Vampire », « Yeondo Mungu Space
  // Station » contre « Space Urara », « TEASLOW × Musinsa Beauty » contre
  // « OFF BEAUTY ». Ils nomment un décor, pas un événement.
  'house', 'room', 'space', 'station', 'beauty', 'local', 'world', 'land', 'life', 'club',
  'story', 'garden', 'lab', 'book', 'books', 'art', 'arts', 'studio', 'season',
  'character', 'characters', 'friends', 'goods', 'edit', 'project',
]);

/**
 * Les mots du nom qui désignent quelque chose, sans les nombres.
 *
 * Une année (« Oktoberfest Seoul 2026 » contre « Exposition internationale de
 * jardins de Séoul 2026 ») désigne le calendrier, pas l'événement.
 */
export function signature(nom) {
  return new Set(
    String(nom ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/)
      .filter((mot) => mot.length >= 3 && !/^\d+$/.test(mot) && !BANALITÉS.has(mot))
  );
}

/**
 * Les mots que PLUSIEURS événements de l'onglet partagent, donc qui ne
 * désignent plus rien.
 *
 * La liste à la main ne peut pas tout prévoir : « animate » (trois cafés
 * collaboratifs), « gratte », « sanrio » reviennent d'une semaine à l'autre, et
 * chacun ferait passer un pop-up neuf pour un doublon. Ce qui les trahit est
 * dans la donnée : un mot qui nomme deux événements différents de l'onglet ne
 * peut pas servir à les distinguer.
 *
 * Calculée SUR LE SEUL ONGLET, jamais sur les fiches du registre : l'onglet et
 * le registre nomment forcément le même événement deux fois quand ils le
 * connaissent tous les deux, et compter cela rendrait « riftbound » générique
 * le jour même où il sert à reconnaître le doublon.
 *
 * @param {object[]} connus
 * @returns {Set<string>}
 */
export function motsGénériques(connus = []) {
  const compte = new Map();
  for (const connu of connus) {
    for (const mot of signature(connu?.name)) compte.set(mot, (compte.get(mot) ?? 0) + 1);
  }
  return new Set([...compte].filter(([, n]) => n >= 2).map(([mot]) => mot));
}

/** L'adresse, réduite à ce qui désigne une page. */
function cléUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * L'événement de l'onglet que cette fiche redit, s'il y en a un.
 *
 * DEUX PREUVES, et pas celles de doublonParLieu(). La même fiche déjà citée
 * par l'onglet est le cas facile, exact, et il couvre les quarante-sept
 * événements que l'onglet tient déjà du registre. L'autre cas est celui qui
 * lui échappe : l'onglet connaît l'événement PAR UNE AUTRE SOURCE, sous un
 * nom français, avec un lieu écrit autrement (« 성수 에스팩토리 » contre
 * l'adresse entière) — ni l'adresse, ni le lieu, ni la ressemblance de chaîne
 * ne le reconnaissent. Ce qui le reconnaît, c'est un mot qui désigne, la
 * marque ou le personnage, et des dates qui se recouvrent.
 *
 * DE QUEL CÔTÉ ON SE TROMPE. Un faux doublon écarte en silence le pop-up qu'on
 * cherchait — c'est la panne même qu'on répare ici. Une fiche reproposée alors
 * que l'onglet la tient ne coûte, elle, qu'une ligne de veille : l'onglet est
 * dans la consigne du rédacteur, qui la reconnaîtra. La règle penche donc du
 * côté du neuf, et c'est pourquoi le mot qui la déclenche doit DÉSIGNER :
 * ni de la plomberie de titre, ni un lieu, ni un mot que deux événements de
 * l'onglet se partagent déjà.
 *
 * @param {object} event
 * @param {object[]} connus
 * @param {{génériques?: Set<string>}} [p]
 * @returns {{connu: object, preuve: string}|null}
 */
export function déjàDansOnglet(event, connus = [], { génériques = motsGénériques(connus) } = {}) {
  const clé = cléUrl(event.source_url);
  const mots = [...signature(event.name)].filter((mot) => !génériques.has(mot));
  for (const connu of connus) {
    if (clé && cléUrl(connu.source_url) === clé) return { connu, preuve: 'même fiche' };
    if (!connu.start_date || !connu.end_date) continue;
    if (!périodesSeRecouvrent(event, connu)) continue;
    const communs = mots.filter((mot) => signature(connu.name).has(mot));
    if (communs.length) return { connu, preuve: `dates et « ${communs.join(' ')} »` };
  }
  return null;
}

// --- La récolte ---------------------------------------------------------------

/**
 * Un `fetch` qui répond de mémoire pour les pages déjà lues.
 *
 * Les gardes sondent la source de chaque événement, et c'est leur raison
 * d'être : une adresse inventée est le mode de défaillance le plus probable
 * d'un modèle. Ici, aucune adresse n'est inventée — elles viennent de l'index
 * du registre, et on vient de LIRE la page, c'est même de là que sortent les
 * dates. Sonder à nouveau serait soixante requêtes de plus vers un seul site
 * pour redemander ce qu'on tient déjà (« aucune raison d'en marteler une
 * seule », dit guards.mjs). Le verdict rendu ici est donc vrai, et daté de la
 * lecture.
 *
 * Une adresse jamais lue passe, elle, au vrai `fetch` : le repli ne ment pas.
 */
export function fetcheurDeCache(vues, fetcher = fetch) {
  return async (url, init = {}) => {
    const html = vues.get(String(url));
    if (html === undefined) return fetcher(url, init);
    return {
      ok: true,
      status: 200,
      url: String(url),
      text: async () => html,
      json: async () => JSON.parse(html),
    };
  };
}

/** Combien de fois une fiche se redemande après un 429, et après combien de temps. */
export const REPRISES_429 = 3;
export const PAUSE_429_MS = 30_000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Une page, lue, ou l'erreur en clair. Un 429 n'est pas une panne de la
 * fiche mais un « pas si vite » : on attend (Retry-After s'il le dit) et on
 * redemande, sans quoi une rafale coûte deux mille fiches d'un coup.
 */
async function lire(url, { fetcher, timeoutMs, attendre = dormir }) {
  for (let essai = 0; ; essai++) {
    try {
      return await lireUneFois(url, { fetcher, timeoutMs });
    } catch (e) {
      if (!e.retryAfterMs || essai >= REPRISES_429) throw e;
      await attendre(e.retryAfterMs);
    }
  }
}

async function lireUneFois(url, { fetcher, timeoutMs }) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: ENTÊTES, redirect: 'follow', signal: controller.signal });
    if (res.status === 429) {
      const dit = Number(res.headers?.get?.('retry-after'));
      throw Object.assign(new Error('HTTP 429'), { retryAfterMs: dit > 0 ? dit * 1000 : PAUSE_429_MS });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (e.retryAfterMs) throw e;
    throw new Error(e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message);
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Le registre entier : l'index, puis chaque fiche.
 *
 * L'index en panne est une panne (rien à énumérer) ; une fiche en panne est
 * une fiche en moins, et le journal la nomme.
 *
 * @param {object} [p]
 * @param {object} [p.registre]
 * @param {Function} [p.fetcher]
 * @param {number} [p.timeoutMs]
 * @param {number} [p.concurrence]
 * @param {number} [p.max]            plafond de fiches lues, pour les essais
 * @param {Set<string>} [p.sauter]    fiches déjà écartées un matin précédent (NEMONE.mémoire)
 * @returns {Promise<{registre: object, candidats: {event: object, matière: string, adresse: string}[], fiches: number, écartées: {url: string, raison: string}[], pannes: {url: string, raison: string}[], vues: Map<string, string>}>}
 */
export async function récolter({
  registre = REGISTRE,
  fetcher = fetch,
  timeoutMs = 15_000,
  concurrence = registre.concurrence ?? CONCURRENCE,
  max = Infinity,
  sauter = new Set(),
  attendre = dormir,
} = {}) {
  const vues = new Map();
  const index = await lire(registre.index, { fetcher, timeoutMs });
  vues.set(registre.index, index);

  const toutes = registre.adresses?.(index) ?? adressesDeFiches(index, { base: registre.index, fiche: registre.fiche });
  const adresses = toutes.filter((url) => !sauter.has(url)).slice(0, Math.min(max, registre.plafond ?? Infinity));
  const candidats = new Array(adresses.length);
  const écartées = [];
  const pannes = [];
  let prochain = 0;

  // Un pool, comme checkLinks : une vague avancerait au rythme de sa fiche la
  // plus lente.
  async function travailleur() {
    for (let i = prochain++; i < adresses.length; i = prochain++) {
      const url = adresses[i];
      try {
        const html = await lire(url, { fetcher, timeoutMs, attendre });
        const trouvé = événementDeFiche(html, { url, registre });
        // Seules les fiches retenues serviront de cache aux gardes : garder
        // les deux mille pages écartées de NEMONE, ce serait trois cents Mo.
        if (trouvé.event) {
          vues.set(url, html);
          candidats[i] = trouvé;
        }
        else if (trouvé.règle) écartées.push({ url, raison: trouvé.raison });
        else pannes.push({ url, raison: trouvé.raison });
      } catch (e) {
        pannes.push({ url, raison: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrence, adresses.length) }, travailleur));

  return {
    registre,
    candidats: candidats.filter(Boolean),
    fiches: adresses.length,
    sautées: toutes.length - adresses.length,
    écartées,
    pannes,
    vues,
  };
}

// --- La mémoire des fiches écartées -------------------------------------------

/**
 * Combien de jours une fiche écartée ne se relit pas.
 *
 * Une boutique permanente le reste, un atelier aussi : les relire chaque matin
 * serait deux mille six cents requêtes pour apprendre la même chose. Mais une
 * fiche peut changer — des dates annoncées après coup —, donc l'oubli vient,
 * ÉTALÉ sur une seconde période : sans quoi les fiches écartées le même jour
 * reviendraient toutes le même matin, et ce matin-là durerait vingt minutes.
 */
export const OUBLI_JOURS = 30;

/** Un décalage stable de 0 à OUBLI_JOURS - 1 jours, tiré de l'adresse. */
function étalement(url) {
  let h = 0;
  for (const c of String(url)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % OUBLI_JOURS;
}

const jourPlus = (jour, n) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Les fiches à ne pas relire ce matin.
 *
 * @param {Record<string, {raison: string, le: string}>} mémoire
 * @param {string} jour
 * @returns {Set<string>}
 */
export function àSauter(mémoire = {}, jour) {
  return new Set(
    Object.entries(mémoire)
      .filter(([url, { le }]) => jourPlus(le, OUBLI_JOURS + étalement(url)) > jour)
      .map(([url]) => url)
  );
}

/**
 * La mémoire, après la récolte du matin : ce que la règle a écarté, et ce qui
 * est fini — un pop-up terminé ne rouvre pas. Les entrées oubliées tombent.
 *
 * @param {Record<string, {raison: string, le: string}>} mémoire
 * @param {{écartées: {url: string, raison: string}[], candidats: {event: object}[]}} récolte
 * @param {string} jour
 */
export function retenirÉcartées(mémoire = {}, { écartées = [], candidats = [] }, jour) {
  const gardées = àSauter(mémoire, jour);
  const suite = Object.fromEntries(Object.entries(mémoire).filter(([url]) => gardées.has(url)));
  for (const { url, raison } of écartées) suite[url] = { raison, le: jour };
  for (const { event } of candidats) {
    if (event.end_date < jour) suite[event.source_url] = { raison: 'terminé', le: jour };
  }
  return suite;
}

// --- La section de la veille --------------------------------------------------

/** Du plus proche d'aujourd'hui au plus lointain, ouvert ou à ouvrir. */
export function parProximité(candidats, jour) {
  const écart = ({ event }) => Math.abs(Date.parse(`${event.start_date}T00:00:00Z`) - Date.parse(`${jour}T00:00:00Z`));
  return [...candidats].sort((a, b) => écart(a) - écart(b));
}

/**
 * La section « Pop-ups du registre » de la veille.
 *
 * Les mises en avant portent leur JSON, prêt à recopier, et leur matière
 * anglaise en dessous. Le reste tient une ligne chacun : il est VISIBLE, et
 * il sera réénuméré demain, donc rien ne se perd à ne pas le prendre.
 */
export function rendreRegistre({
  candidats = [],
  écartées = [],
  àCompléter = [],
  àSourcer = [],
  parRègle = [],
  pannes = [],
  fiches = 0,
  jour,
  registres = [REGISTRE],
  max = MISES_EN_AVANT,
  panne = null,
} = {}) {
  const noms = registres.map((r) => r.nom).join(', ').replace(/, ([^,]+)$/, ' et $1');
  const lignes = [`## Pop-ups des registres (${noms})`, ''];
  if (panne) {
    lignes.push(
      `Les registres n'ont rien rendu (${panne}). Les pistes de Gemini, plus bas, sont tout ce qu'il y a ce matin.`,
      ''
    );
    return lignes.join('\n');
  }

  lignes.push(
    `Énumérées, pas cherchées : les ${fiches} fiches de ${registres.map((r) => r.index).join(' et ')}, lues une par une, moins celles que l'onglet tient déjà.`,
    'Dates, adresse en hangul et quartier viennent du JSON-LD de la fiche, que le script a lu ce matin : **rien n\'est deviné, et rouvrir la source n\'apprendrait rien de plus**.',
    '',
    '**Deux champs sont à toi.** `name` : le registre écrit en anglais, donne-lui son nom français. `summary` : il MANQUE du JSON, écris-le en français, 35 mots au plus, de la matière donnée sous chaque fiche. `theme` est une proposition d\'après les mots du registre — tranche-la, c\'est le prompt qui dit où passent les frontières.',
    ''
  );

  const triés = parProximité(candidats, jour);
  const avant = triés.slice(0, max);
  const reste = triés.slice(max);

  if (!avant.length) {
    lignes.push("Rien de neuf au registre ce matin : l'onglet le tient entier.", '');
  }
  for (const { event, matière } of avant) {
    lignes.push(`### ${event.name} · ${event.theme ?? 'thème à trancher'} · ${event.start_date} → ${event.end_date}`, '');
    lignes.push('```json', JSON.stringify(event, null, 2), '```', '');
    if (matière) lignes.push(`Matière (anglais, du registre) : ${matière}`, '');
  }
  if (reste.length) {
    lignes.push(
      `Le reste du registre, ${reste.length} fiches, si la place le permet — sinon elles reviendront demain, le registre se réénumère :`,
      ''
    );
    for (const { event } of reste) {
      lignes.push(`- ${event.name} · ${event.start_date} → ${event.end_date} · ${event.source_url}`);
    }
    lignes.push('');
  }
  // Le lieu manque, et rien d'autre. Les jeter serait perdre un concert que
  // personne d'autre n'annonce, pour un champ qui se retrouve en une
  // recherche : NOL World romanise ses lieux, et la table des salles ne peut
  // pas tout connaître. L'adresse romanisée est donnée telle quelle, c'est de
  // quoi trouver le nom coréen sur Naver Map.
  if (àCompléter.length) {
    lignes.push(
      `**Il ne leur manque que le lieu en coréen**, que le registre écrit en lettres latines. Cherche le nom coréen du lieu sur Naver Map, mets-le dans \`venue\`, et l'événement tient debout — sinon, laisse-le :`,
      ''
    );
    for (const { event, adresse } of àCompléter) {
      // L'adresse n'est répétée que si elle dit autre chose que le lieu : quand
      // le registre n'a pas nommé le lieu, c'est déjà elle qui en tient lieu.
      const indice = adresse && adresse !== event.venue ? `, ${adresse}` : '';
      lignes.push(
        `- ${event.name} · ${event.theme ?? 'thème à trancher'} · ${event.start_date} → ${event.end_date} · lieu « ${event.venue} »${indice} · ${event.source_url}`
      );
    }
    lignes.push('');
  }
  // Ce qu'un registre qu'on ne cite pas a vu, et qu'aucun autre n'a vu. Pas
  // de JSON : il inviterait à recopier une fiche écrite par un modèle. Le
  // travail est celui des agrégateurs dans la consigne — trouver qui
  // l'annonce.
  if (àSourcer.length) {
    const triées = parProximité(àSourcer, jour);
    const montrées = triées.slice(0, À_SOURCER_MAX);
    const nom = montrées[0].registre ?? 'un agrégateur';
    lignes.push(
      `**Vues chez ${nom} seulement, à sourcer.** ${nom} écrit ses fiches par un modèle et ne se cite pas : pour en garder une, trouve la page du lieu, de la marque ou une rédaction qui donne ces dates et ce lieu, et cite-la — le nom coréen se trouve sur la fiche. Rien de tel : laisse-la, elle reviendra demain.`,
      ''
    );
    for (const { event } of montrées) {
      lignes.push(
        `- ${event.name} · ${event.theme ?? 'thème à trancher'} · ${event.start_date} → ${event.end_date} · ${event.venue} (${event.area}) · ${event.source_url}`
      );
    }
    if (triées.length > montrées.length) {
      lignes.push(`- et ${triées.length - montrées.length} autres, plus lointaines, qui reviendront`);
    }
    lignes.push('');
  }
  if (écartées.length) {
    lignes.push(`Déjà dans l'onglet ou écartées au tri, ne les repropose pas :`, '');
    for (const { event, raison } of écartées) lignes.push(`- ${event.name ?? '(sans nom)'} : ${raison}`);
    lignes.push('');
  }
  if (parRègle.length) {
    lignes.push(
      `Écartées par la règle, sans date de fin annoncée ou sans lieu : ${parRègle.map(({ registre, n }) => `${n} fiches de ${registre}`).join(', ')}.`,
      ''
    );
  }
  if (pannes.length) {
    lignes.push(`Fiches illisibles ce matin : ${pannes.map(({ url, raison }) => `${url} (${raison})`).join(' ; ')}`, '');
  }
  return lignes.join('\n');
}
