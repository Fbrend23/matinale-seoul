// La veille actualité, confiée à Gemini AVANT la session de rédaction, dans la
// presse que les flux RSS ne couvrent pas, et triée par les gardes du dépôt
// avant d'atteindre l'agent.
//
// POURQUOI. La veille RSS (lib/veille.mjs) donne trois cents titres par matin,
// mais dix-sept flux, tous anglophones sauf deux : Chosun, JoongAng, Hankyoreh,
// KBS, Inven, ZDNet Korea, Visit Korea n'y sont pas, et la rubrique tourisme
// vit sur les seules pages voyage du Korea Herald. Ce que ces rédactions
// publient se cherche, en coréen, et c'est une recherche, pas une rédaction :
// Google la fait mieux, et une session Gemini par rubrique la fait sur un
// abonnement dont la recherche est le point fort, sans que ses résultats
// s'entassent dans le contexte de la session qui rédige. Même raisonnement
// que la recherche d'événements (lib/recherche.mjs), même tri derrière.
//
// UNE SESSION PAR RUBRIQUE, et non une seule pour les cinq : le budget d'une
// session s'épuise sur ce qui vient en premier, la recherche d'événements l'a
// montré deux matins de suite. Cinq sessions, cinq budgets, et le sport a le
// sien.
//
// POURQUOI UN TRI ICI. Gemini rend une liste ; il ne connaît ni l'allowlist ni
// ce que la veille porte déjà, et il invente des adresses comme n'importe quel
// modèle. Chaque piste est donc sondée comme un item le serait à l'ingestion,
// allowlist et lien vivant, puis comparée à ce que le site a publié et à ce
// que les flux ont déjà donné : une piste qui refait un titre de la veille est
// un doublon, pas un apport. Ce qui atteint l'agent est une adresse vue,
// vivante, d'une rédaction connue, qui n'est nulle part ailleurs dans la veille.
//
// Le module ne lance rien : la commande vit dans scripts/actualite.mjs, et tout
// ce qui touche au réseau reçoit son `fetch`, comme dans guards.mjs.

import { checkAllowlist, checkLinks, findDuplicates, hostOf, similarity } from './guards.mjs';
import { SECTIONS } from '../../shared/sections.mjs';
import { isoSéoul } from './veille.mjs';

/** Au plus tant de pistes par rubrique, par matin : l'agent choisit, il ne trie pas. */
export const MAX_PAR_SECTION = 8;

/** Au plus tant de pistes d'un même domaine par rubrique, pour la même raison qu'en recherche. */
export const MAX_PAR_SOURCE = 3;

/**
 * Deux titres qui se ressemblent à ce point disent la même histoire.
 *
 * Plus bas que la garde des doublons (0.85), qui juge des titres français
 * écrits par le même agent : ici l'on compare un titre de Gemini à un titre
 * de flux, deux rédactions, et deux titres de la même dépêche ne se
 * ressemblent qu'à moitié. Mesuré sur la veille du 18 septembre 2026 : la
 * même déclaration de Kim Yo-jong chez Yonhap et au Dong-A fait 0.58, et le
 * couple le plus proche sans rapport, sur trois cents titres, 0.48. Le
 * seuil passe entre les deux. Un filtre faible, et c'est voulu : une piste
 * qui refait un titre des flux est un doublon que l'agent voit et laisse ;
 * une piste neuve écartée à tort ne revient pas.
 */
export const SEUIL_MÊME_HISTOIRE = 0.55;

/**
 * Les cinq volets, un par rubrique : ce qu'elle couvre, et le terrain que
 * les flux ne couvrent pas, où Gemini doit chercher.
 *
 * Le terrain est dit à Gemini avec les mots des sites coréens : l'anglais
 * remonte les mêmes rédactions que les flux, le coréen remonte les autres.
 * Tout ce qui est nommé ici est dans l'allowlist (config/sources.json), un
 * test le vérifie : une piste sourcée ailleurs serait écartée au tri, et
 * Gemini aurait cherché pour rien.
 */
export const VOLETS_ACTUALITE = [
  {
    section: 'tourisme',
    description:
      "voyager en Corée, y entrer, y séjourner : visas et K-ETA, aéroports et compagnies, trains et bus, cartes de transport, hébergement, change, ouvertures de lieux, événements ouverts au public, chiffres du tourisme",
    terrain:
      "Visit Korea (visitkorea.or.kr, english.visitkorea.or.kr), korea.net, Visit Seoul (visitseoul.net), la ville de Séoul (seoul.go.kr), Yonhap en coréen (yna.co.kr), Chosun (chosun.com, english.chosun.com), JoongAng (joongang.co.kr, koreajoongangdaily.joins.com), Hankyoreh (hani.co.kr), KBS (kbs.co.kr, world.kbs.co.kr), Korea Times, Korea Herald",
    requêtes: "`인천공항`, `K-ETA`, `외국인 관광객`, `방한 관광`, `서울 관광`, `비자`, `한강버스`, `기후동행카드`, `환율 원화`, `호텔 서울`, `추석 연휴 교통`",
  },
  {
    section: 'coree',
    description:
      'la Corée du Sud en général : politique, diplomatie et Corée du Nord, économie, entreprises, société, justice, climat et catastrophes',
    terrain:
      'Chosun (chosun.com, english.chosun.com), JoongAng (joongang.co.kr, koreajoongangdaily.joins.com), Hankyoreh (hani.co.kr, english.hani.co.kr), KBS (kbs.co.kr, world.kbs.co.kr), MBC (mbc.co.kr), SBS (sbs.co.kr), Kukmin Ilbo (kmib.co.kr), Reuters, AP',
    requêtes: '`속보`, `대통령실`, `국회`, `북한`, `한미`, `삼성전자`, `SK하이닉스`, `현대차`, `물가`, `기준금리`, `검찰`, `태풍`, `폭염`',
  },
  {
    section: 'tech',
    description:
      'technologie et IA dans le monde, et la tech coréenne que la presse anglophone ne voit pas : Samsung, SK hynix, Naver, Kakao, LG, les puces, les modèles, les plateformes',
    terrain: 'ZDNet Korea (zdnet.co.kr), etnews (etnews.com), The Elec (thelec.kr), Yonhap en coréen (yna.co.kr), Chosun, JoongAng, Hankyoreh, Wired, Reuters',
    requêtes: '`인공지능`, `AI 모델 출시`, `반도체`, `HBM`, `네이버 AI`, `카카오`, `삼성 갤럭시`, `LG전자`, `데이터센터`, `자율주행`',
  },
  {
    section: 'gaming',
    description:
      'le jeu vidéo dans le monde, et le jeu vidéo coréen que la presse anglophone ne voit pas : Nexon, Krafton, NCSoft, Netmarble, Pearl Abyss, Smilegate, Kakao Games, les sorties, les studios, l\'e-sport',
    terrain: 'Inven (inven.co.kr), This Is Game (thisisgame.com), ZDNet Korea (zdnet.co.kr), etnews (etnews.com), Yonhap en coréen (yna.co.kr), Gamekult, IGN, Rock Paper Shotgun, Game Developer',
    requêtes: '`게임 출시`, `넥슨`, `크래프톤`, `엔씨소프트`, `넷마블`, `펄어비스`, `스마일게이트`, `e스포츠`, `LCK`, `게임 업계`, `스팀 신작`',
  },
  {
    section: 'sport',
    description:
      'le sport en Corée d\'abord, KBO, K League, équipes nationales, grands rendez-vous à Séoul ; les Coréens à l\'étranger ; puis le monde quand il compte pour quelqu\'un qui vit à Séoul',
    terrain: 'Sports Seoul (sportsseoul.com), Yonhap en coréen (yna.co.kr), Chosun, JoongAng, KBS, KBO (koreabaseball.com), K League (kleague.com), ESPN, L\'Équipe, olympics.com, fifa.com',
    requêtes: '`KBO 경기 결과`, `K리그`, `손흥민`, `김민재`, `이강인`, `국가대표`, `아시안게임`, `LPGA 한국`, `서울 마라톤`',
  },
];

/** Les champs qu'une piste peut porter : le reste est ignoré. */
const CHAMPS = ['section', 'headline', 'original_headline', 'summary', 'source_name', 'source_url', 'source_lang', 'published_at'];

/**
 * La consigne d'un volet, remplie : le jour, la rubrique, son terrain,
 * l'allowlist, et ce que la veille porte déjà pour cette rubrique.
 *
 * Un gabarit versionné dans prompts/, comme pour la recherche : la consigne
 * se relit et se corrige par un commit.
 *
 * @param {string} gabarit           prompts/actualite-presse.md
 * @param {object} p
 * @param {string} p.jour            AAAA-MM-JJ à Séoul
 * @param {object} p.volet           un de VOLETS_ACTUALITE
 * @param {string[]} p.domaines      l'allowlist
 * @param {string[]} [p.déjà]        les titres déjà dans la veille et sur le site, pour cette rubrique
 */
export function composerConsigneActualité(gabarit, { jour, volet, domaines = [], déjà = [] }) {
  const listeDéjà = déjà.length ? déjà.map((t) => `- ${t}`).join('\n') : '(rien : la veille est vide pour cette rubrique)';
  return gabarit
    .replaceAll('{{JOUR}}', jour)
    .replaceAll('{{SECTION}}', volet.section)
    .replaceAll('{{DESCRIPTION}}', volet.description)
    .replaceAll('{{TERRAIN}}', volet.terrain)
    .replaceAll('{{REQUETES}}', volet.requêtes)
    .replaceAll('{{DOMAINES}}', domaines.join(', '))
    .replaceAll('{{DEJA}}', listeDéjà);
}

/**
 * Une piste réduite à ses champs, chaînes épurées, champs vides retirés, et
 * rangée dans la rubrique du volet qui l'a rendue : Gemini se trompe parfois
 * de clé, et c'est le volet qui a cherché qui sait pour qui.
 */
export function épurerPiste(piste, section) {
  const propre = {};
  for (const champ of CHAMPS) {
    const v = piste[champ];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t) propre[champ] = t;
  }
  propre.section = section;
  // L'heure, à la forme exacte de `published_at`, celle des flux : à
  // l'essai du 18 septembre 2026, Gemini a rendu « 2026-09-17 » et
  // « …07:12:43.226Z ». Une date sans heure ne dit pas l'heure : elle
  // saute, l'agent lira la page. Une heure avec fuseau se recopie à
  // l'heure de Séoul, comme la veille le fait.
  if (propre.published_at) {
    const complète = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(propre.published_at);
    if (complète && !Number.isNaN(Date.parse(propre.published_at))) propre.published_at = isoSéoul(new Date(propre.published_at));
    else delete propre.published_at;
  }
  return propre;
}

/**
 * Une adresse réduite à ce qui la désigne : sans `utm_*`, sans `#`, sans la
 * barre finale, en minuscules pour l'hôte. Les flux ajoutent `?utm_source=rss`
 * à la même page que Gemini trouve nue, et ce sont les mêmes.
 */
export function cléAdresse(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    const chemin = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${chemin}${u.search}`;
  } catch {
    return String(url ?? '').trim();
  }
}

/**
 * Ce que la veille porte déjà : les adresses et les titres des flux, par
 * rubrique, et les titres publiés par le site. Lu dans le Markdown même que
 * l'agent lira, et non recalculé : c'est contre ce fichier-là que la piste
 * doit être neuve.
 *
 * La veille écrit chaque entrée sur deux ou trois lignes : `- ISO · titre`,
 * puis l'adresse indentée, puis l'extrait. Une rédaction vaut pour les
 * rubriques que `flux.json` lui donne (`### Nom (lang) · coree, tourisme · …`).
 *
 * @param {string} veilleMd
 * @returns {{ adresses: Set<string>, titres: Map<string, string[]>, publiés: string[] }}
 */
export function lireVeille(veilleMd) {
  const adresses = new Set();
  const titres = new Map(SECTIONS.map((s) => [s, []]));
  const publiés = [];
  let rubriques = [];
  let bloc = null;
  for (const ligne of veilleMd.split('\n')) {
    const h2 = /^## (.+)$/.exec(ligne);
    if (h2) {
      bloc = h2[1];
      rubriques = [];
      continue;
    }
    if (bloc?.startsWith('Déjà couvert')) {
      const m = /^- \d{4}-\d{2}-\d{2} · [a-z]+ · (.+)$/.exec(ligne);
      if (m) publiés.push(m[1]);
      continue;
    }
    const h3 = /^### .+ · ([a-z, ]+) · /.exec(ligne);
    if (h3) {
      rubriques = h3[1].split(',').map((s) => s.trim()).filter((s) => titres.has(s));
      continue;
    }
    const adresse = /^\s+(https?:\/\/\S+)$/.exec(ligne);
    if (adresse) {
      adresses.add(cléAdresse(adresse[1]));
      continue;
    }
    const titre = /^- \d{4}-\d{2}-\d{2}T[^ ]+ · (.+)$/.exec(ligne);
    if (titre) for (const r of rubriques) titres.get(r).push(titre[1]);
  }
  return { adresses, titres, publiés };
}

/**
 * Ce que Gemini a proposé, passé au tri.
 *
 * Dans cet ordre, et l'ordre compte : ce qui est déjà dans la veille n'a pas
 * à être sondé, et une adresse morte n'a pas à être comparée. Puis l'allowlist,
 * qui écarte ici quand elle ne fait que retenir en brouillon à l'ingestion :
 * une piste n'est pas un item, personne n'a encore écrit dessus, et l'agent
 * n'a pas à recevoir une adresse qui retiendrait son brief. Puis la sonde,
 * avec les trois verdicts de la garde 2 : un refus garde la piste, il ne
 * prouve pas qu'elle est inventée. Puis les doublons, contre le site (titres
 * français) et contre les flux (titres originaux), et entre pistes. Enfin
 * les plafonds.
 *
 * @param {object[]} pistes                déjà épurées
 * @param {object} p
 * @param {string[]} p.domaines
 * @param {ReturnType<typeof lireVeille>} p.veille
 * @param {Function} [p.fetcher]
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{retenues: object[], écartées: {piste: object, raison: string}[]}>}
 */
export async function trierPistesActualité(pistes, { domaines, veille, fetcher = fetch, timeoutMs = 10_000 }) {
  const écartées = [];
  const candidates = [];

  for (const piste of pistes) {
    if (!piste.source_url || !/^https:\/\//.test(piste.source_url)) {
      écartées.push({ piste, raison: 'sans adresse source en https' });
    } else if (!piste.headline && !piste.original_headline) {
      écartées.push({ piste, raison: 'sans titre' });
    } else if (veille.adresses.has(cléAdresse(piste.source_url))) {
      écartées.push({ piste, raison: 'déjà dans les flux de la veille' });
    } else if (checkAllowlist([piste], domaines).length) {
      écartées.push({ piste, raison: `domaine hors allowlist : ${hostOf(piste.source_url) ?? piste.source_url}` });
    } else {
      candidates.push(piste);
    }
  }

  const sondes = await checkLinks(candidates, { fetcher, timeoutMs });
  const vivantes = [];
  for (const sonde of sondes) {
    if (sonde.verdict === 'mort') écartées.push({ piste: sonde.item, raison: `source morte (${sonde.reason})` });
    else vivantes.push(sonde.verdict === 'refusé' ? { ...sonde.item, accès: 'refusé' } : sonde.item);
  }

  // Les titres du site sont en français, ceux des flux dans la langue de
  // la rédaction : chaque comparaison se fait dans la bonne langue.
  const doublonsSite = new Set(findDuplicates(vivantes.map((p) => ({ ...p, headline: p.headline ?? p.original_headline })), veille.publiés).map((d) => d.item.source_url));
  const gardées = [];
  for (const piste of vivantes) {
    if (doublonsSite.has(piste.source_url)) {
      écartées.push({ piste, raison: 'histoire déjà publiée par le site' });
      continue;
    }
    const titresFlux = veille.titres.get(piste.section) ?? [];
    const original = piste.original_headline ?? piste.headline;
    const pareil = titresFlux.find((t) => similarity(original, t) >= SEUIL_MÊME_HISTOIRE);
    if (pareil) {
      écartées.push({ piste, raison: `même histoire dans les flux : « ${pareil.slice(0, 50)} »` });
      continue;
    }
    const jumelle = gardées.find((g) => g.section === piste.section && similarity(g.original_headline ?? g.headline, original) >= SEUIL_MÊME_HISTOIRE);
    if (jumelle) {
      écartées.push({ piste, raison: `même histoire qu'une autre piste : « ${(jumelle.headline ?? jumelle.original_headline).slice(0, 50)} »` });
      continue;
    }
    gardées.push(piste);
  }

  // Les plafonds, dans l'ordre où Gemini a rendu, le sien.
  const parSection = new Map();
  const parSource = new Map();
  const retenues = [];
  for (const piste of gardées) {
    const nS = (parSection.get(piste.section) ?? 0) + 1;
    const cléSource = `${piste.section}|${hostOf(piste.source_url)}`;
    const nD = (parSource.get(cléSource) ?? 0) + 1;
    parSection.set(piste.section, nS);
    parSource.set(cléSource, nD);
    if (nS > MAX_PAR_SECTION) écartées.push({ piste, raison: `${nS}e piste de la rubrique, ${MAX_PAR_SECTION} au plus` });
    else if (nD > MAX_PAR_SOURCE) écartées.push({ piste, raison: `${nD}e de ${hostOf(piste.source_url)} pour cette rubrique, ${MAX_PAR_SOURCE} par source` });
    else retenues.push(piste);
  }

  return { retenues, écartées };
}

/**
 * La section « Pistes actualité » de la veille, en Markdown, pour l'agent.
 *
 * La même forme que les flux, ligne pour ligne : l'agent lit une adresse vue
 * avec son heure et un extrait, et n'a pas deux façons de lire la veille.
 * S'y ajoutent le titre en français de Gemini, qui sert à choisir, et la
 * rédaction avec sa langue. Un accès refusé à la sonde est dit : l'agent
 * saura qu'il devra peut-être passer par une recherche pour l'ouvrir.
 *
 * `pannes` : les volets qui n'ont rien rendu. La section les nomme, pour que
 * l'agent sache qu'une rubrique n'a pas été cherchée, ce qui n'est pas
 * « il n'y avait rien ».
 */
export function rendrePistesActualité({ retenues = [], écartées = [], pannes = [] } = {}) {
  const lignes = ['## Pistes actualité', ''];
  if (pannes.length === VOLETS_ACTUALITE.length) {
    lignes.push(`La veille de la presse coréenne n'a rien donné (${[...new Set(pannes.map((p) => p.panne))].join(' ; ')}). Les flux ci-dessus sont tout ce qu'il y a.`, '');
    return lignes.join('\n');
  }
  lignes.push(
    "Cherchées par Gemini avant ta session dans la presse que les flux ne couvrent pas, surtout coréenne, puis passées au tri : allowlist, lien vivant, doublons du site et des flux. Chaque adresse est une adresse vue : elle peut servir de `source_url` telle quelle, et son heure de `published_at` quand elle est donnée.",
    "L'extrait sert à choisir, pas à résumer : ouvre l'article retenu avant de l'écrire. Ces pistes complètent les flux, elles ne les remplacent pas.",
    ''
  );
  for (const section of SECTIONS) {
    const pistes = retenues.filter((p) => p.section === section);
    const panne = pannes.find((p) => p.section === section);
    const n = pistes.length;
    lignes.push(`### ${section} · ${panne ? `non cherchée (${panne.panne})` : `${n} piste${n > 1 ? 's' : ''}`}`);
    if (pistes.length) lignes.push('');
    for (const p of pistes) {
      const quand = p.published_at ?? 'heure non donnée';
      const original = p.original_headline && p.original_headline !== p.headline ? p.original_headline : p.headline;
      lignes.push(`- ${quand} · ${original} (${p.source_name ?? hostOf(p.source_url)}, ${p.source_lang ?? '?'})`);
      lignes.push(`  ${p.source_url}`);
      const détails = [p.headline && p.headline !== original ? p.headline : null, p.summary, p.accès === 'refusé' ? 'accès refusé à la sonde : la page existe sans doute, ouvre-la ou cherche son titre' : null].filter(Boolean);
      if (détails.length) lignes.push(`  ${détails.join(' — ')}`);
    }
    lignes.push('');
  }
  if (écartées.length) {
    lignes.push('Écartées au tri, ne les recherche pas :', '');
    for (const { piste, raison } of écartées) {
      const où = piste.source_url ? ` (${hostOf(piste.source_url) ?? piste.source_url})` : '';
      lignes.push(`- ${piste.section} · ${(piste.headline ?? piste.original_headline ?? '(sans titre)').slice(0, 70)}${où} : ${raison}`);
    }
    lignes.push('');
  }
  return lignes.join('\n');
}
