// Les cinq gardes. Elles remplacent la relecture humaine : rien d'autre ne se
// tient entre ce qu'un agent a écrit et ce que le site publie.
//
// Tout est pur, sauf checkLinks qui reçoit son `fetch` en paramètre. C'est ce
// qui rend les gardes testables sans réseau, donc réellement testées.
//
// Deux niveaux de sanction, jamais confondus :
//   · un ITEM recalé est retiré, le brief part sans lui ;
//   · un BRIEF recalé n'est pas publié du tout.
// Une seule garde a un troisième comportement, l'allowlist : elle ne retire
// rien et ne recale rien, elle retient le brief en brouillon.

// Le schéma est écrit en draft 2020-12. L'export par défaut d'Ajv, lui, parle
// draft-07 et refuse le méta-schéma sans jamais dire que le tort vient de là.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Importé ET réexporté : checkCoherence() s'en sert comme valeur par défaut, et
// une simple réexportation ne met pas le nom dans la portée du module.
import { seoulToday } from '../../shared/date.mjs';

export { SECTIONS, SECTION_LABELS } from '../../shared/sections.mjs';

export const MAX_SUMMARY_WORDS = 40;
export const DUPLICATE_THRESHOLD = 0.85;

// --- Garde 1 : schéma --------------------------------------------------------

/**
 * Valide le brief contre le schéma formel.
 *
 * `strict: false` : le schéma porte des `description` à but documentaire dans
 * des emplacements qu'Ajv juge inhabituels, et refuser un schéma commenté
 * n'apporterait rien.
 */
// Compiler un schéma Ajv coûte une vingtaine de millisecondes, et le schéma ne
// change pas d'un brief à l'autre. Une WeakMap plutôt qu'une Map : elle ne
// retient pas le schéma en vie, et deux schémas différents — les fixtures des
// tests — gardent chacun le sien.
const validateurs = new WeakMap();

function validateurPour(schema) {
  let valider = validateurs.get(schema);
  if (!valider) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    valider = ajv.compile(schema);
    validateurs.set(schema, valider);
  }
  return valider;
}

export function validateSchema(brief, schema) {
  const validate = validateurPour(schema);

  if (validate(brief)) return [];

  return validate.errors.map((e) => {
    const où = e.instancePath || '(racine)';
    return `${où} ${e.message}`;
  });
}

// --- Garde 2 : liens vivants -------------------------------------------------

// Ce que le robot dit de lui-même. Le `fetch` de Node s'annonce « undici », que
// beaucoup de sites de presse refusent — et un refus retirait jusqu'ici l'item.
//
// Un en-tête DESCRIPTIF, et non un faux navigateur : se déguiser pour passer
// irait contre tout ce que ce dépôt tient par ailleurs, et se ferait bloquer
// tout autant. Celui-ci nomme le robot et dit où le joindre, ce qui est la seule
// forme qu'un éditeur puisse décider d'autoriser.
const AGENT =
  'MatinaleDeSeoul/1.0 (vérificateur de liens ; +https://github.com/Fbrend23/matinale-seoul)';

const ENTÊTES = {
  'User-Agent': AGENT,
  'Accept-Language': 'fr,en;q=0.8,ko;q=0.6',
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
};

// Codes qui disent « on m'a refusé l'entrée », et non « cette page n'existe
// pas ». Voir le verdict « refusé » plus bas.
const REFUS = new Set([401, 403, 406, 429]);

// Codes par lesquels un serveur dit son désaccord avec la MÉTHODE, pas avec la
// ressource : il faut redemander en GET avant de conclure quoi que ce soit.
const REESSAYER_EN_GET = new Set([401, 403, 405, 406, 501]);

// Combien d'adresses sont sondées de front.
//
// En séquence, un brief de treize items pouvait coûter plus de deux minutes —
// dix secondes d'attente par lien muet, et le double quand HEAD échoue avant
// GET. Sur une rédaction de douze minutes qui n'a que dix-huit minutes de marge
// avant 8 h, et un contrôle avant vol que l'agent rejoue à chaque correction,
// c'était le poste le plus cher de la chaîne.
//
// Six, et non trente : ces requêtes partent vers une poignée de rédactions, et
// il n'y a aucune raison d'en marteler une seule pour gagner deux secondes.
const CONCURRENCE = 6;

/**
 * Vérifie que chaque source répond vraiment.
 *
 * La garde la plus rentable des cinq : un modèle qui invente une URL
 * plausible est le mode de défaillance le plus probable, et c'est le seul que
 * ni le schéma ni la relecture du texte ne voient passer.
 *
 * HEAD d'abord, GET en repli : beaucoup de serveurs répondent 405 à HEAD, et
 * en conclure que le lien est mort retirerait des items parfaitement valides.
 *
 * TROIS VERDICTS, ET NON DEUX. La garde cherche les URL INVENTÉES. Or un 403
 * ne dit pas que la page n'existe pas : il dit qu'on n'a pas voulu nous la
 * montrer — mur anti-robot, mur payant, filtrage géographique. Conclure « lien
 * mort » retirait l'item en silence, et le journal imputait alors à la source
 * ce qui venait de la garde.
 *
 *   vivant  → 2xx, l'item passe et porte la date de sa vérification
 *   refusé  → 401/403/406/429, l'item passe SANS date : le champ dit alors
 *             exactement ce qu'il sait, c'est-à-dire rien
 *   mort    → 404, 5xx, pas de réponse : l'item est retiré
 *
 * C'est le raisonnement de la garde 3, qui ne jette rien non plus parce que
 * « jeter l'item ferait disparaître la source sans que personne ne l'apprenne ».
 */
export async function checkLinks(
  items,
  { fetcher = fetch, timeoutMs = 10_000, concurrence = CONCURRENCE } = {}
) {
  // Indexé, et non empilé : les sondes finissent dans le désordre, mais
  // l'ingestion associe les résultats aux items par leur RANG.
  const results = new Array(items.length);
  let prochain = 0;

  // Un pool, et non des vagues : une vague avance au rythme de son item le plus
  // lent, et un seul serveur muet ferait attendre les cinq autres dix secondes.
  async function travailleur() {
    for (let i = prochain++; i < items.length; i = prochain++) {
      results[i] = await sonder(items[i], { fetcher, timeoutMs });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrence, items.length) }, travailleur)
  );

  return results;
}

/** Une seule adresse, et le verdict qu'elle mérite. */
async function sonder(item, { fetcher, timeoutMs }) {
  let statut = null;
  let raison = null;

  for (const method of ['HEAD', 'GET']) {
    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(item.source_url, {
        method,
        redirect: 'follow',
        headers: ENTÊTES,
        signal: controller.signal,
      });
      statut = res.status;
      if (res.ok) break;
      // Le serveur refuse la méthode, ou refuse un robot qui ne demande
      // qu'un en-tête : on redemande la page entière avant de conclure.
      if (method === 'HEAD' && REESSAYER_EN_GET.has(res.status)) continue;
      raison = `HTTP ${res.status}`;
      break;
    } catch (e) {
      raison = e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message;
      // Un échec réseau sur HEAD peut venir de la méthode : on tente GET.
      if (method === 'HEAD') continue;
    } finally {
      clearTimeout(minuteur);
    }
  }

  const vivant = statut !== null && statut >= 200 && statut < 300;
  const refusé = !vivant && REFUS.has(statut);
  const verdict = vivant ? 'vivant' : refusé ? 'refusé' : 'mort';

  return {
    item,
    verdict,
    // Le seul usage de ce champ est « garde-t-on l'item ? ». Un refus le
    // garde : c'est toute la raison du troisième verdict.
    ok: verdict !== 'mort',
    reason: vivant ? null : (raison ?? 'injoignable'),
    // Une date de vérification sur une page qu'on n'a pas vue serait fausse.
    checkedAt: vivant ? new Date().toISOString() : null,
  };
}

// --- Garde 3 : allowlist de domaines ----------------------------------------

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Un domaine inconnu ne fait pas sauter l'item : il retient le brief entier en
 * brouillon. Jeter l'item ferait disparaître la source sans que personne ne
 * l'apprenne, et la liste ne s'enrichirait jamais.
 */
export function checkAllowlist(items, domains) {
  const connus = new Set(domains.map((d) => d.replace(/^www\./, '').toLowerCase()));
  const inconnus = [];

  for (const item of items) {
    const host = hostOf(item.source_url);
    if (!host) {
      inconnus.push({ item, host: item.source_url });
      continue;
    }
    // Un sous-domaine d'un domaine connu l'est aussi : « english.hani.co.kr »
    // suit « hani.co.kr » sans qu'on ait à énumérer les rédactions.
    const couvert = [...connus].some((d) => host === d || host.endsWith(`.${d}`));
    if (!couvert) inconnus.push({ item, host });
  }

  return inconnus;
}

// --- Garde 4 : doublons ------------------------------------------------------

/** Réduit un titre à ce qui se compare : sans casse, sans accents, sans ponctuation. */
export function normalize(texte) {
  return texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Un titre réduit à ses bigrammes, avec leur compte total.
 *
 * Séparé de `similarity` parce que c'est tout le coût de la garde : la comparer
 * à N titres reconstruisait N fois les MÊMES bigrammes, des deux côtés. Vingt
 * items contre quatorze jours d'archive, cela faisait plus de dix mille
 * constructions pour trois cents titres distincts.
 */
function empreinte(texte) {
  const t = normalize(texte).replace(/\s+/g, ' ');
  const paires = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const paire = t.slice(i, i + 2);
    paires.set(paire, (paires.get(paire) ?? 0) + 1);
  }

  let total = 0;
  for (const n of paires.values()) total += n;

  return { texte, paires, total };
}

/** Le coefficient de Dice entre deux empreintes déjà calculées. */
function dice(a, b) {
  const total = a.total + b.total;
  // Deux titres trop courts pour porter un seul bigramme : il ne reste qu'à
  // les comparer tels quels.
  if (total === 0) return normalize(a.texte) === normalize(b.texte) ? 1 : 0;

  // On parcourt la plus petite des deux tables : le résultat est le même, et le
  // travail suit alors le titre le plus court.
  const [petite, grande] = a.paires.size <= b.paires.size ? [a.paires, b.paires] : [b.paires, a.paires];

  let communs = 0;
  for (const [paire, n] of petite) communs += Math.min(n, grande.get(paire) ?? 0);

  return (2 * communs) / total;
}

/**
 * Coefficient de Dice sur les bigrammes.
 *
 * Choisi plutôt qu'une distance d'édition parce qu'il ne se laisse pas
 * impressionner par l'ordre des mots : deux rédactions titrant la même
 * histoire ne le font presque jamais dans le même ordre.
 */
export function similarity(a, b) {
  return dice(empreinte(a), empreinte(b));
}

/** Items dont le titre reprend une histoire déjà couverte les jours précédents. */
export function findDuplicates(items, recentHeadlines, seuil = DUPLICATE_THRESHOLD) {
  // Chaque titre n'est réduit qu'une fois, d'un côté comme de l'autre.
  const anciens = recentHeadlines.map(empreinte);
  const doublons = [];

  for (const item of items) {
    const courant = empreinte(item.headline);
    let meilleur = { score: 0, contre: null };

    for (const ancien of anciens) {
      const score = dice(courant, ancien);
      if (score > meilleur.score) meilleur = { score, contre: ancien.texte };
    }

    if (meilleur.score >= seuil) {
      doublons.push({ item, score: meilleur.score, against: meilleur.contre });
    }
  }

  return doublons;
}

// --- Garde 5 : cohérence -----------------------------------------------------

// Le jour, tel qu'il est à Séoul : c'est de là que le brief parle. Le calcul vit
// dans shared/, parce que le site le fait aussi et qu'un désaccord entre les deux
// ferait recaler un brief que le site daterait pourtant juste.
export const seoulDate = seoulToday;

export function wordCount(texte) {
  return normalize(texte).split(/\s+/).filter(Boolean).length;
}

/**
 * Ce qu'un schéma ne peut pas dire.
 *
 * Chaque règle ici correspond à une façon dont un brief peut être bien formé et
 * malgré tout faux : daté d'hier, vidé de sa substance, ou classé n'importe
 * comment.
 */
export function checkCoherence(brief, { today = seoulDate() } = {}) {
  const erreurs = [];

  if (brief.date !== today) {
    erreurs.push(`daté du ${brief.date}, or il est le ${today} à Séoul`);
  }

  const nonVides = brief.sections.filter((s) => s.items.length > 0);
  if (nonVides.length < 2) {
    erreurs.push(`${nonVides.length} section(s) non vide(s) : un brief en demande au moins deux`);
  }

  const clés = brief.sections.map((s) => s.key);
  if (new Set(clés).size !== clés.length) {
    erreurs.push('une section apparaît deux fois');
  }

  for (const section of brief.sections) {
    const rangs = section.items.map((i) => i.importance);
    if (new Set(rangs).size !== rangs.length) {
      erreurs.push(`section « ${section.key} » : deux items se disputent le même rang`);
    }

    const analyses = section.items.filter((i) => i.analysis != null && i.analysis !== '');
    if (analyses.length > 1) {
      erreurs.push(`section « ${section.key} » : ${analyses.length} analyses, une au plus`);
    }

    for (const item of section.items) {
      const mots = wordCount(item.summary);
      if (mots > MAX_SUMMARY_WORDS) {
        erreurs.push(
          `« ${item.headline.slice(0, 60)} » : résumé de ${mots} mots, ${MAX_SUMMARY_WORDS} au plus`
        );
      }
    }
  }

  return erreurs;
}

// --- Pourquoi une rubrique est vide ------------------------------------------

/**
 * Ce que l'ingestion écrit quand les gardes ont retiré le dernier item.
 *
 * Une rubrique vidée à la vérification n'est PAS une rubrique sans actualité,
 * et le lecteur mérite la différence : il y avait des sujets, aucune de leurs
 * sources n'a tenu.
 */
export const VIDÉE_PAR_LES_GARDES =
  "Des sujets étaient proposés ce matin, mais aucune de leurs sources n'a pu être vérifiée.";

/**
 * La phrase à afficher sous chaque rubrique restée vide, indexée par sa clé.
 *
 * L'agent en écrit une pour chaque rubrique qu'il laisse vide — le schéma l'y
 * oblige. Elle était jusqu'ici validée puis jetée : ni écrite dans le CMS, ni
 * lue au build, le site affichant à sa place une phrase générale codée en dur.
 * Un texte produit, contraint et perdu, dans un dépôt dont toute la doctrine
 * est de ne rien laisser disparaître en silence.
 *
 * Se calcule sur le brief APRÈS les gardes : une rubrique vidée par des liens
 * morts arrive ici sans note, et reçoit la sienne.
 *
 * @returns {Record<string, string>|null} null quand aucune rubrique n'est vide,
 *   pour que la clé reste hors de la charge écrite — comme pour la météo, ne
 *   rien avoir à dire ne doit pas effacer ce qu'un passage précédent a dit.
 */
export function emptyNotes(brief) {
  const notes = {};

  for (const section of brief.sections) {
    if (section.items.length > 0) continue;
    notes[section.key] = section.empty_note?.trim() || VIDÉE_PAR_LES_GARDES;
  }

  return Object.keys(notes).length ? notes : null;
}

// --- Utilitaires partagés ----------------------------------------------------

/** Tous les items d'un brief, à plat, chacun sachant de quelle section il vient. */
export function flatten(brief) {
  return brief.sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.key }))
  );
}

/**
 * L'inverse : le même brief, ne gardant que les items donnés.
 *
 * C'est sur CE brief que se juge la cohérence — la garde 5 se prononce sur ce
 * qui reste une fois les liens morts et les doublons retirés, jamais sur ce que
 * l'agent a proposé.
 *
 * Partagé parce que l'ingestion et le contrôle avant vol le reconstruisaient
 * chacun de son côté, et que le second est censé PRÉDIRE le verdict du premier :
 * deux reconstructions qui divergeraient feraient mentir le contrôle avant vol,
 * qui dirait « ce brief passerait » d'un brief que la CI recalerait.
 */
export function unflatten(brief, items) {
  return {
    ...brief,
    sections: brief.sections.map((section) => ({
      ...section,
      items: items.filter((item) => item.section === section.key),
    })),
  };
}

export function slugFor(date) {
  return `brief-${date}`;
}
