// La recherche d'événements, confiée à Gemini AVANT la session de rédaction,
// et triée par les gardes du dépôt avant d'atteindre l'agent.
//
// POURQUOI GEMINI. La veille RSS a réglé le brief : les rédactions publient
// leurs titres dans un flux. Rien de tel pour les pop-ups et concerts de
// Séoul, qu'on trouve en cherchant, en coréen, sur des sites qui n'ont pas de
// flux. C'est le morceau qui restait cher dans la session Claude, seize appels
// pour deux événements le 15 septembre 2026, et c'est une recherche, pas une
// rédaction : Google la fait mieux, et une session Gemini, par Antigravity
// CLI, la fait sur un abonnement dont la recherche est le point fort, sans
// que ses résultats s'entassent dans le contexte de la session qui rédige.
//
// POURQUOI UN TRI ICI. Gemini rend une liste ; il ne connaît ni l'allowlist ni
// les gardes, et il invente des adresses comme n'importe quel modèle. Chaque
// piste passe donc EXACTEMENT le tri que l'ingestion fera subir à l'événement :
// contrôlerÉvénements(), le même code, avec l'allowlist, les doublons de
// l'onglet et une sonde sur le lien. Ce qui atteint l'agent est ce qui serait
// retenu. Il lui reste à ouvrir la source une fois, pour les dates et le lieu,
// puis à écrire.
//
// Le module ne lance rien : la commande vit dans scripts/recherche.mjs, et tout
// ce qui touche au réseau reçoit son `fetch`, comme dans guards.mjs.

import { contrôlerÉvénements, doublonParLieu } from './evenements.mjs';
import { hostOf } from './guards.mjs';
import { normaliserLieu } from '../../shared/evenements.mjs';

/**
 * Au plus tant de pistes par domaine source, par matin.
 *
 * Le premier run, le 15 septembre 2026, a rendu huit pistes, propres, toutes
 * d'insideseoul.app : Gemini avait lu la première page qui liste, trouvé son
 * compte, et arrêté là. La consigne demande la variété, mais une consigne se
 * contourne ; le plafond, non. Le quatrième d'un même domaine est écarté, il
 * ne disparaît pas : il sera là demain, ou sous une autre source.
 *
 * IL BORNE UNE RECHERCHE, PAS UN INVENTAIRE. Le plafond existe parce qu'une
 * session qui cherche s'arrête à la première page qui liste, et qu'on ne veut
 * pas d'un matin entier tiré d'un seul site. Quand un script ÉNUMÈRE un
 * registre (scripts/popups.mjs), tout vient du même domaine par construction
 * et le plafond ne protège plus de rien : celui-là passe
 * `maxParSource: Infinity`, et c'est la veille qui décide combien de fiches
 * elle met en avant.
 */
export const MAX_PAR_SOURCE = 3;

/**
 * Les salles que les billetteries écrivent en latin, et leur nom Naver.
 *
 * Le 15 et le 16 septembre 2026, Flash comme Pro ont rendu « KSPO DOME »
 * pour deux concerts, TXT et &TEAM, et le tri les a écartés deux matins de
 * suite : lieu sans hangul, Naver Map ne le trouverait pas. La consigne
 * demande le coréen, et un modèle qui recopie world.nol.com ne le fait pas.
 * Une table vaut mieux qu'une consigne plus insistante : elle ne se contourne
 * pas, et ce sont toujours les mêmes salles. Les grandes salles de concert,
 * les parcs et places des festivals, les centres de salons ; pas les grands
 * magasins ni les boutiques, où c'est la succursale qui compte et qu'une
 * table ne saurait deviner.
 *
 * Clé : le nom latin normalisé par normaliserLieu(), sans espaces ni casse.
 */
export const LIEUX_EN_COREEN = Object.fromEntries(
  Object.entries({
    'KSPO DOME': 'KSPO돔',
    'KSPO Dome': 'KSPO돔',
    'Olympic Gymnastics Arena': 'KSPO돔',
    'Gocheok Sky Dome': '고척스카이돔',
    'Gocheok Dome': '고척스카이돔',
    'Inspire Arena': '인스파이어 아레나',
    'KINTEX': '킨텍스',
    'COEX': '코엑스',
    'DDP': '동대문디자인플라자',
    'Dongdaemun Design Plaza': '동대문디자인플라자',
    'Olympic Hall': '올림픽홀',
    'Olympic Park': '올림픽공원',
    'Jamsil Arena': '잠실실내체육관',
    'Jamsil Indoor Stadium': '잠실실내체육관',
    'Jamsil Olympic Stadium': '잠실종합운동장',
    'Seoul Olympic Stadium': '잠실종합운동장',
    'Jamsil Sports Complex': '잠실종합운동장',
    'Seoul World Cup Stadium': '서울월드컵경기장',
    'Goyang Stadium': '고양종합운동장',
    'SK Handball Gymnasium': 'SK핸드볼경기장',
    'Handball Gymnasium': 'SK핸드볼경기장',
    'Blue Square': '블루스퀘어',
    'YES24 Live Hall': '예스24 라이브홀',
    'Sejong Center': '세종문화회관',
    'Seoul Arts Center': '예술의전당',
    'Gwanghwamun Square': '광화문광장',
    'Seoul Plaza': '서울광장',
    'Namsangol Hanok Village': '남산골한옥마을',
    'Nanji Hangang Park': '난지한강공원',
    'Ttukseom Hangang Park': '뚝섬한강공원',
    'Yeouido Hangang Park': '여의도한강공원',
    'Banpo Hangang Park': '반포한강공원',
    'Seoul Forest': '서울숲',
    'Lotte World Tower': '롯데월드타워',
    'Seoul Station': '서울역',
    // Les lieux que NOL World nomme, depuis que le dépôt l'énumère
    // (scripts/lib/popups.mjs) : il romanise tout, y compris ce qu'aucune
    // billetterie n'écrivait en latin jusqu'ici. Sans ces lignes, un festival
    // au palais de Gyeongbokgung était écarté « lieu sans hangul » chaque
    // matin, faute d'une traduction que personne ne peut deviner.
    'Gyeongbokgung Palace': '경복궁',
    'Gyeongbokgung': '경복궁',
    'Changdeokgung Palace': '창덕궁',
    'Deoksugung Palace': '덕수궁',
    'Unhyeongung': '운현궁',
    'Gwangwhamun': '광화문',
    'Gwanghwamun': '광화문',
    'HiKR Ground': '하이커그라운드',
    'Banpo Bridge Moonlight Rainbow Fountain': '반포대교 달빛무지개분수',
    'Myunghwa Live Hall': '명화라이브홀',
    'Namsan Seoul Tower': 'N서울타워',
    // Une succursale NOMMÉE, et non une enseigne : « 더현대 서울 » désigne un
    // seul bâtiment, à Yeouido, ce que « Hyundai Department Store » tout court
    // ne ferait pas — d'où la règle du paragraphe ci-dessus, qui tient.
    'The Hyundai Seoul': '더현대 서울',
    'Hyundai Department Store The Hyundai Seoul': '더현대 서울',
  }).map(([latin, coréen]) => [normaliserLieu(latin), coréen])
);

/**
 * Le lieu tel que Naver l'écrit, quand la table le connaît ; sinon tel quel.
 *
 * Une parenthèse en fin de nom, « KSPO DOME (Olympic Park) », est un
 * complément, pas un autre lieu : elle saute avant la table. Un lieu déjà en
 * coréen n'est pas touché, la table ne parle que le latin.
 *
 * @param {string} venue
 * @returns {string}
 */
export function lieuEnCoréen(venue) {
  const clé = normaliserLieu(String(venue ?? '').replace(/\s*\([^)]*\)\s*$/, ''));
  return LIEUX_EN_COREEN[clé] ?? venue;
}

/** Les champs qu'un événement peut porter : le reste ferait recaler le brief au schéma. */
const CHAMPS = [
  'name', 'kind', 'theme', 'venue', 'area', 'start_date', 'end_date', 'summary',
  'source_name', 'source_url', 'source_lang', 'booking_url', 'map_url',
];

/**
 * La consigne de Gemini, remplie : le jour, l'onglet tel qu'il est, l'allowlist.
 *
 * Quatre gabarits, et pas un rendu à la main dans le script : la consigne est
 * versionnée dans prompts/, relue, et c'est là qu'on la corrige.
 *
 * `{{METHODE}}` reçoit la façon de chercher, qui change d'un volet à l'autre
 * quand le reste, thèmes, onglet, allowlist, forme de la réponse, ne change
 * pas : voir VOLETS.
 *
 * @param {string} gabarit           prompts/recherche-evenements.md
 * @param {object} p
 * @param {string} p.jour            AAAA-MM-JJ à Séoul
 * @param {object[]} p.connus        les événements de l'onglet
 * @param {string[]} p.domaines      la presse : les rédactions
 * @param {string[]} [p.officiels]   lieux, enseignes, labels : citables pour un événement
 * @param {string[]} [p.agrégateurs] les recenseurs : pour chercher, jamais pour citer
 * @param {string} [p.méthode]       prompts/recherche-methode-*.md
 */
export function composerConsigne(
  gabarit,
  { jour, connus = [], domaines = [], officiels = [], agrégateurs = [], méthode = '' }
) {
  const listeConnus = connus.length
    ? connus.map((e) => `- ${e.start_date} → ${e.end_date} · ${e.theme} · ${e.name} · ${e.venue ?? ''}`.trimEnd()).join('\n')
    : "(l'onglet est vide ou injoignable : rien n'est connu)";
  return gabarit
    .replaceAll('{{JOUR}}', jour)
    .replaceAll('{{CONNUS}}', listeConnus)
    .replaceAll('{{DOMAINES}}', domaines.join(', '))
    .replaceAll('{{OFFICIELS}}', officiels.join(', '))
    .replaceAll('{{AGREGATEURS}}', agrégateurs.join(', '))
    .replaceAll('{{METHODE}}', méthode.trim());
}

/**
 * Deux sessions Gemini par matin, en parallèle, une méthode chacune.
 *
 * Une seule session avec les deux méthodes, c'était la consigne des
 * premiers matins, et elle disait « les recherches en coréen ne sont pas
 * facultatives » : Flash comme Pro lisaient les quatre pages qui listent,
 * y trouvaient leur compte, et rendaient zéro piste venue d'une recherche en
 * coréen, dix thèmes durant, deux matins de suite. Le budget d'une session
 * s'épuise sur ce qui vient en premier. Deux sessions, c'est deux budgets,
 * et le coréen a le sien. Elles tournent ensemble, l'abonnement Google le
 * permet et la matinée n'attend pas ; leurs pistes se rejoignent avant le
 * tri, qui dédoublonne.
 */
export const VOLETS = [
  { nom: 'pages', méthode: 'prompts/recherche-methode-pages.md' },
  { nom: 'coréen', méthode: 'prompts/recherche-methode-coreen.md' },
];

/**
 * Le tableau JSON dans ce que Gemini a répondu.
 *
 * On lui demande « le tableau, et rien d'autre », et on prend ce qu'il envoie :
 * une clôture ```json, une phrase avant, une après. Ce qui se lit entre le
 * premier `[` et le dernier `]` est le tableau ; s'il ne s'analyse pas, la
 * réponse ne vaut rien, et c'est une panne, pas une liste vide. La
 * différence compte pour le journal : « Gemini n'a rien trouvé » et « Gemini
 * a répondu n'importe quoi » ne se corrigent pas au même endroit.
 *
 * @param {string} texte
 * @returns {object[]}
 */
export function extraireTableau(texte) {
  const début = texte.indexOf('[');
  const fin = texte.lastIndexOf(']');
  if (début < 0 || fin < début) throw new Error('aucun tableau JSON dans la réponse');
  let tableau;
  try {
    tableau = JSON.parse(texte.slice(début, fin + 1));
  } catch (e) {
    throw new Error(`tableau JSON illisible : ${e.message}`);
  }
  if (!Array.isArray(tableau)) throw new Error('la réponse n\'est pas un tableau');
  return tableau.filter((p) => p && typeof p === 'object' && !Array.isArray(p));
}

/**
 * Une piste réduite aux champs d'un événement, chaînes épurées, champs vides
 * retirés. Gemini ajoute volontiers un `note` ou un `confidence` : un champ de
 * plus dans le brief est une faute de schéma, qui recale le fichier entier.
 */
export function épurer(piste) {
  const propre = {};
  for (const champ of CHAMPS) {
    const v = piste[champ];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t) propre[champ] = t;
  }
  return propre;
}

/**
 * L'adresse derrière une redirection.
 *
 * La recherche Google rend ses résultats derrière des adresses de renvoi
 * (vertexaisearch.cloud.google.com/grounding-api-redirect/…), et un modèle
 * les recopie telles quelles. Cette adresse-là n'est dans aucune allowlist et
 * ne dit pas d'où vient l'information : on la suit une fois, et c'est la
 * page d'arrivée qui est jugée. Une adresse qui ne mène nulle part est
 * rendue telle quelle, la sonde de contrôlerÉvénements() la dira morte.
 *
 * @param {string} url
 * @param {{fetcher?: Function, timeoutMs?: number}} [p]
 * @returns {Promise<string>}
 */
export async function résoudre(url, { fetcher = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (matinale-seoul; recherche)' },
    });
    return typeof res.url === 'string' && /^https?:\/\//.test(res.url) ? res.url : url;
  } catch {
    return url;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Ce que Gemini a proposé, passé au tri de l'ingestion.
 *
 * Résout d'abord chaque adresse, puis confie le reste à contrôlerÉvénements() :
 * cohérence, allowlist, doublons de l'onglet, lien vivant. Une prolongation
 * repérée par Gemini, même nom, dates nouvelles, ressort dans `prolongées`
 * et l'agent la repropose avec le même `name`, comme le prompt le lui demande.
 *
 * `connus` sert deux fois, aux doublons et à la prolongation, et c'est
 * l'onglet tel que le site le donne, pas une liste de noms : sans les dates,
 * toute ressemblance serait un doublon.
 *
 * @param {object[]} pistes
 * @param {object} p
 * @param {string[]} p.domaines        presse + officiels, voir lib/sources.mjs
 * @param {string[]} [p.agrégateurs]
 * @param {object[]} [p.connus]
 * @param {string} p.today
 * @param {Function} [p.fetcher]
 * @param {number} [p.timeoutMs]
 * @param {number} [p.maxParSource]  le plafond par domaine ; `Infinity` pour une énumération
 * @returns {Promise<{retenues: object[], écartées: {event: object, raison: string}[], prolongées: {event: object, connu: object}[]}>}
 */
export async function trierPistes(
  pistes,
  {
    domaines,
    agrégateurs = [],
    connus = [],
    today,
    fetcher = fetch,
    timeoutMs = 10_000,
    maxParSource = MAX_PAR_SOURCE,
  }
) {
  // Le lieu en coréen quand la table le connaît, AVANT le tri : c'est le
  // test du hangul qui écartait KSPO DOME, et il ne sait pas traduire.
  const épurées = pistes.map(épurer).map((p) => (p.venue ? { ...p, venue: lieuEnCoréen(p.venue) } : p));

  // Sans adresse, rien à résoudre ni à sonder : la cohérence ne l'attraperait
  // pas (elle ne regarde pas la source), l'allowlist rendrait « domaine
  // inconnu : undefined ». On le dit en clair.
  const sansSource = épurées.filter((p) => !p.source_url);
  const avecSource = épurées.filter((p) => p.source_url);

  const résolues = await Promise.all(
    avecSource.map(async (p) => ({ ...p, source_url: await résoudre(p.source_url, { fetcher, timeoutMs }) }))
  );

  const { retenus, écartés, prolongés } = await contrôlerÉvénements(résolues, {
    domaines,
    agrégateurs,
    connus,
    today,
    fetcher,
    timeoutMs,
  });

  // Les doublons du matin, entre pistes : contrôlerÉvénements() ne compare
  // qu'à l'onglet, pas les pistes entre elles, et deux volets peuvent tomber
  // sur le même concert, l'un par la billetterie, l'autre par la rédaction.
  // La règle est celle de l'onglet, doublonParLieu(), et pas une plus
  // simple : « même lieu, même jour » écarterait les trois pop-ups qui
  // ouvrent le même vendredi à The Hyundai. Le premier rendu reste.
  const gardées = [];
  const doublonsDuMatin = [];
  for (const event of retenus) {
    const trouvé = doublonParLieu(event, gardées);
    if (trouvé) doublonsDuMatin.push({ event, raison: `doublon du matin (${trouvé.preuve}) : « ${trouvé.connu.name.slice(0, 50)} »` });
    else gardées.push(event);
  }
  const uniques = gardées;

  // Le plafond par domaine, après le tri : il ne compte que ce qui serait
  // retenu, et dans l'ordre où Gemini l'a rendu, le sien.
  const parDomaine = new Map();
  const retenues = [];
  const excédent = [];
  for (const event of uniques) {
    const hôte = hostOf(event.source_url);
    const n = (parDomaine.get(hôte) ?? 0) + 1;
    parDomaine.set(hôte, n);
    if (n <= maxParSource) retenues.push(event);
    else excédent.push({ event, raison: `${n}e de ${hôte} ce matin, ${maxParSource} par source` });
  }

  // link_checked_at est une information de l'ingestion, pas un champ du
  // schéma : dans le brief, il ferait recaler le fichier.
  const sansTampon = ({ link_checked_at, ...event }) => event;

  return {
    retenues: retenues.map(sansTampon),
    écartées: [
      ...sansSource.map((event) => ({ event, raison: 'sans adresse source' })),
      ...écartés,
      ...doublonsDuMatin.map(({ event, raison }) => ({ event: sansTampon(event), raison })),
      ...excédent.map(({ event, raison }) => ({ event: sansTampon(event), raison })),
    ],
    prolongées: prolongés.map(({ event, connu }) => ({ event: sansTampon(event), connu })),
  };
}

/**
 * La section « Pistes événements » de la veille, en Markdown, pour l'agent.
 *
 * Chaque piste retenue est rendue en JSON, telle que l'agent la recopiera dans
 * `events` après avoir ouvert la source : il n'a pas à la retaper, et ce qui
 * est recopié n'est pas réinventé. Les écartées ne sont données que par leur
 * nom et leur raison : l'agent n'a pas à les rechercher, et le journal du
 * matin sans événement se lit ici.
 *
 * `panne` : Gemini n'a pas répondu, ou a répondu n'importe quoi. La section
 * le dit et renvoie l'agent à sa propre recherche, avec son budget.
 */
export function rendrePistes({ retenues = [], écartées = [], prolongées = [], panne = null } = {}) {
  const lignes = ['## Pistes événements', ''];
  if (panne) {
    lignes.push(`La recherche du matin n'a rien donné (${panne}). Cherche toi-même, avec le budget du prompt.`, '');
    return lignes.join('\n');
  }
  lignes.push(
    'Relevées par Gemini avant ta session, puis passées au tri de l\'ingestion : allowlist, dates, doublons de l\'onglet, lien vivant.',
    'Chaque piste retenue est un événement tel que tu peux le recopier dans `events`, **après avoir ouvert sa source une fois** pour confirmer les dates et le lieu. Ne cherche pas d\'autres événements tant qu\'il en reste ici.',
    ''
  );
  if (!retenues.length && !prolongées.length) {
    lignes.push('Aucune piste retenue ce matin. Cherche toi-même, avec le budget du prompt.', '');
  }
  for (const event of retenues) {
    lignes.push(`### ${event.name} · ${event.theme} · ${event.start_date} → ${event.end_date}`, '');
    lignes.push('```json', JSON.stringify(event, null, 2), '```', '');
  }
  for (const { event, connu } of prolongées) {
    lignes.push(
      `### ${event.name} · ${event.theme} · dates nouvelles ${event.start_date} → ${event.end_date}`,
      '',
      `Déjà dans l'onglet (« ${connu.name} », ${connu.start_date} → ${connu.end_date}) : une prolongation ou un report. Repropose-le avec le nom connu si la source confirme.`,
      '',
      '```json',
      JSON.stringify({ ...event, name: connu.name }, null, 2),
      '```',
      ''
    );
  }
  if (écartées.length) {
    lignes.push(`Écartées au tri, ne les recherche pas :`, '');
    for (const { event, raison } of écartées) {
      const où = event.source_url ? ` (${hostOf(event.source_url) ?? event.source_url})` : '';
      lignes.push(`- ${event.name ?? '(sans nom)'}${où} : ${raison}`);
    }
    lignes.push('');
  }
  return lignes.join('\n');
}
