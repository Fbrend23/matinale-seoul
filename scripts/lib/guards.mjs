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
export function validateSchema(brief, schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (validate(brief)) return [];

  return validate.errors.map((e) => {
    const où = e.instancePath || '(racine)';
    return `${où} ${e.message}`;
  });
}

// --- Garde 2 : liens vivants -------------------------------------------------

/**
 * Vérifie que chaque source répond vraiment.
 *
 * La garde la plus rentable des cinq : un modèle qui invente une URL
 * plausible est le mode de défaillance le plus probable, et c'est le seul que
 * ni le schéma ni la relecture du texte ne voient passer.
 *
 * HEAD d'abord, GET en repli : beaucoup de serveurs répondent 405 à HEAD, et
 * en conclure que le lien est mort retirerait des items parfaitement valides.
 */
export async function checkLinks(items, { fetcher = fetch, timeoutMs = 10_000 } = {}) {
  const results = [];

  for (const item of items) {
    let statut = null;
    let raison = null;

    for (const method of ['HEAD', 'GET']) {
      const controller = new AbortController();
      const minuteur = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher(item.source_url, {
          method,
          redirect: 'follow',
          signal: controller.signal,
        });
        statut = res.status;
        if (res.ok) break;
        // 405 : le serveur refuse la méthode, pas la ressource.
        if (method === 'HEAD' && (res.status === 405 || res.status === 501)) continue;
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
    results.push({
      item,
      ok: vivant,
      reason: vivant ? null : (raison ?? 'injoignable'),
      checkedAt: new Date().toISOString(),
    });
  }

  return results;
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
 * Coefficient de Dice sur les bigrammes.
 *
 * Choisi plutôt qu'une distance d'édition parce qu'il ne se laisse pas
 * impressionner par l'ordre des mots : deux rédactions titrant la même
 * histoire ne le font presque jamais dans le même ordre.
 */
export function similarity(a, b) {
  const bigrammes = (s) => {
    const t = normalize(s).replace(/\s+/g, ' ');
    const paires = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const paire = t.slice(i, i + 2);
      paires.set(paire, (paires.get(paire) ?? 0) + 1);
    }
    return paires;
  };

  const ga = bigrammes(a);
  const gb = bigrammes(b);
  const total = [...ga.values()].reduce((n, v) => n + v, 0) + [...gb.values()].reduce((n, v) => n + v, 0);
  if (total === 0) return normalize(a) === normalize(b) ? 1 : 0;

  let communs = 0;
  for (const [paire, n] of ga) communs += Math.min(n, gb.get(paire) ?? 0);

  return (2 * communs) / total;
}

/** Items dont le titre reprend une histoire déjà couverte les jours précédents. */
export function findDuplicates(items, recentHeadlines, seuil = DUPLICATE_THRESHOLD) {
  const doublons = [];

  for (const item of items) {
    let meilleur = { score: 0, contre: null };
    for (const ancien of recentHeadlines) {
      const score = similarity(item.headline, ancien);
      if (score > meilleur.score) meilleur = { score, contre: ancien };
    }
    if (meilleur.score >= seuil) {
      doublons.push({ item, score: meilleur.score, against: meilleur.contre });
    }
  }

  return doublons;
}

// --- Garde 5 : cohérence -----------------------------------------------------

/** Le jour, tel qu'il est à Séoul : c'est de là que le brief parle. */
export function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

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

// --- Utilitaires partagés ----------------------------------------------------

/** Tous les items d'un brief, à plat, chacun sachant de quelle section il vient. */
export function flatten(brief) {
  return brief.sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.key }))
  );
}

export function slugFor(date) {
  return `brief-${date}`;
}
