// Ce qui écarte un événement — et rien ici ne recale un brief.
//
// Les items ont cinq gardes et deux sanctions : l'item sauté, ou le brief
// recalé. Les événements n'ont qu'une sanction, l'ÉVÉNEMENT ÉCARTÉ. Ils sont
// un accessoire du brief, comme la météo : un pop-up mal sourcé ne doit pas
// priver Séoul de sa Matinale. La seule exception est le schéma, qui juge le
// fichier entier — et c'est la garde 1, pas ce module.
//
// Même différence pour l'allowlist. Sur un item, un domaine inconnu RETIENT le
// brief en brouillon, pour que la liste s'enrichisse. Sur un événement, il
// écarte : retenir le brief ferait payer à toute l'actualité une boutique
// éphémère, et le journal du run dit le domaine tout aussi bien.
//
// Tout est pur, sauf les sondes de liens qui reçoivent leur `fetch` — comme
// dans guards.mjs, et pour la même raison : testable sans réseau.

import {
  checkLinks,
  checkAllowlist,
  findDuplicates,
  wordCount,
  MAX_SUMMARY_WORDS,
} from './guards.mjs';
import { enCoréen } from '../../shared/evenements.mjs';

/** Les liens facultatifs d'un événement : vérifiés, jamais décisifs. */
const LIENS_FACULTATIFS = ['booking_url', 'map_url'];

/**
 * « 2026-02-31 » passe le motif du schéma. Seul un aller-retour par Date
 * dit si le jour existe.
 */
function dateRéelle(jour) {
  const d = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

/**
 * Ce qu'un schéma ne peut pas dire d'un événement.
 *
 * Hors de checkCoherence() à dessein : la garde 5 recale le brief, et une date
 * de fin passée ne doit écarter que l'événement qui la porte.
 *
 * @param {object} event
 * @param {{today: string}} p  le jour à Séoul
 * @returns {string[]}
 */
export function cohérenceÉvénement(event, { today }) {
  const erreurs = [];

  const débutRéel = dateRéelle(event.start_date);
  const finRéelle = dateRéelle(event.end_date);
  if (!débutRéel) erreurs.push(`date de début irréelle : ${event.start_date}`);
  if (!finRéelle) erreurs.push(`date de fin irréelle : ${event.end_date}`);

  if (débutRéel && finRéelle && event.end_date < event.start_date) {
    erreurs.push(`finit le ${event.end_date}, avant d'avoir commencé le ${event.start_date}`);
  }

  // Le dernier jour est inclus : un événement qui finit aujourd'hui vaut
  // encore d'être annoncé ce matin.
  if (finRéelle && event.end_date < today) {
    erreurs.push(`terminé le ${event.end_date}, or il est le ${today} à Séoul`);
  }

  const mots = wordCount(event.summary);
  if (mots > MAX_SUMMARY_WORDS) {
    erreurs.push(`résumé de ${mots} mots, ${MAX_SUMMARY_WORDS} au plus`);
  }

  // Sans fiche vue, l'épingle est une recherche Naver Map sur le lieu — et
  // Naver ne trouve pas « Hiker Ground », seulement « 하이커그라운드 ». Un lieu
  // en lettres latines donnerait un bouton qui s'ouvre sur rien.
  if (!event.map_url && !enCoréen(event.venue)) {
    erreurs.push(`lieu sans hangul : « ${event.venue} » — Naver Map ne le trouvera pas`);
  }

  return erreurs;
}

/**
 * Trie les événements proposés : ce qui passe, ce qui est écarté, et pourquoi.
 *
 * L'ordre va du gratuit au coûteux — cohérence, allowlist, doublons, puis les
 * sondes réseau. Il ne change aucun verdict, puisque tout écarte ; il évite
 * seulement de sonder une adresse pour un événement déjà terminé.
 *
 * Les doublons se jugent sur le NOM, contre les événements encore actifs, avec
 * la même mesure que les titres : deux rédactions ne nomment presque jamais un
 * pop-up dans les mêmes mots, et un rejeu se reconnaît à 1,00.
 *
 * Un doublon dont les DATES ont changé n'est pas écarté : c'est une
 * prolongation ou un report, et la fiche connue est à mettre à jour. Il passe
 * les mêmes sondes qu'un événement neuf — une prolongation annoncée par un
 * lien mort ne vaut rien — et ressort dans `prolongés`, avec la fiche à
 * corriger. Ce sont les seules écritures que l'ingestion fait sur un
 * événement qu'elle n'a pas créé.
 *
 * Les liens facultatifs — billetterie, fiche Naver Map — sont sondés eux
 * aussi, mais un lien mort ne retire que le CHAMP : l'événement reste, et le
 * site pose son lien de recherche à la place de la fiche. Une limite à
 * connaître : map.naver.com est une application qui répond 200 à n'importe
 * quelle fiche, inventée ou non ; seuls les liens courts naver.me répondent
 * 404. La sonde est honnête, elle n'est pas complète — d'où le repli.
 *
 * @param {object[]} events         brief.events, tel que l'agent l'a écrit
 * @param {object} p
 * @param {string[]} p.domaines     l'allowlist
 * @param {{name: string, start_date?: string, end_date?: string, id?: any}[]} [p.connus]
 *   les événements actifs déjà connus, avec leurs dates pour reconnaître une
 *   prolongation
 * @param {string} p.today          le jour à Séoul
 * @param {Function} [p.fetcher]    injectable, comme checkLinks
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{
 *   retenus: object[],
 *   écartés: {event: object, raison: string}[],
 *   liensRetirés: {event: object, champ: string, raison: string}[],
 *   prolongés: {event: object, connu: object}[],
 * }>}
 */
export async function contrôlerÉvénements(
  events,
  { domaines, connus = [], today, fetcher = fetch, timeoutMs = 10_000 }
) {
  const écartés = [];
  const liensRetirés = [];
  const prolongés = [];

  // Des copies : l'agent a écrit ces objets, on ne les retouche pas — les
  // champs qu'on retire ici ne doivent pas disparaître du fichier qu'il relit.
  let survivants = events.map((event) => ({ ...event }));

  const écarter = (event, raison) => écartés.push({ event, raison });

  // --- Cohérence ---
  survivants = survivants.filter((event) => {
    const fautes = cohérenceÉvénement(event, { today });
    if (fautes.length) écarter(event, fautes.join(' ; '));
    return !fautes.length;
  });

  // --- Allowlist : écarte, ne retient pas ---
  const inconnus = checkAllowlist(survivants, domaines);
  for (const { item, host } of inconnus) écarter(item, `domaine inconnu : ${host}`);
  survivants = survivants.filter((event) => !inconnus.some((i) => i.item === event));

  // --- Doublons, sur le nom ---
  // Mêmes dates : déjà connu, écarté. Dates nouvelles : une prolongation, qui
  // continue son chemin marquée de la fiche à corriger.
  const doublons = findDuplicates(
    survivants.map((event) => ({ headline: event.name, event })),
    connus.map((c) => c.name)
  );
  const àProlonger = new Map();
  for (const { item, score, against } of doublons) {
    const connu = connus.find((c) => c.name === against);
    // Une fiche sans dates — une liste de noms seuls — ne peut pas dire si
    // elles ont changé : dans le doute, c'est un doublon.
    const datesNouvelles =
      connu?.start_date && connu?.end_date &&
      (connu.start_date !== item.event.start_date || connu.end_date !== item.event.end_date);
    if (datesNouvelles) {
      àProlonger.set(item.event, connu);
    } else {
      écarter(item.event, `déjà connu (${score.toFixed(2)}) : « ${against.slice(0, 50)} »`);
    }
  }
  survivants = survivants.filter((event) => !doublons.some((d) => d.item.event === event) || àProlonger.has(event));

  // --- La source : vivante, refusée, ou morte ---
  const sondes = await checkLinks(survivants, { fetcher, timeoutMs });
  const retenus = [];
  for (const sonde of sondes) {
    if (sonde.verdict === 'mort') {
      écarter(sonde.item, `source morte : ${sonde.item.source_url} (${sonde.reason})`);
      continue;
    }
    // Un refus garde l'événement sans date, comme pour un item.
    const vérifié = { ...sonde.item, link_checked_at: sonde.checkedAt };
    const connu = àProlonger.get(sonde.item);
    if (connu) prolongés.push({ event: vérifié, connu });
    else retenus.push(vérifié);
  }

  // --- Les liens facultatifs : le champ saute, l'événement reste ---
  const facultatifs = retenus.flatMap((event) =>
    LIENS_FACULTATIFS.filter((champ) => event[champ]).map((champ) => ({
      event,
      champ,
      source_url: event[champ],
    }))
  );
  const sondesFacultatives = await checkLinks(facultatifs, { fetcher, timeoutMs });
  for (const sonde of sondesFacultatives) {
    if (sonde.verdict !== 'mort') continue;
    const { event, champ } = sonde.item;
    delete event[champ];
    liensRetirés.push({ event, champ, raison: sonde.reason });
  }

  return { retenus, écartés, liensRetirés, prolongés };
}
