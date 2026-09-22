// La relecture du brief AVANT sa publication : Gemini rouvre chaque source,
// confronte le résumé à la page, corrige le français, et rend le brief entier ;
// le dépôt vérifie qu'il n'a fait que relire, le contrôle avant vol le juge,
// et c'est le lanceur qui commite.
//
// POURQUOI. Le brief part en ligne sans relecture humaine, et les cinq gardes
// ne lisent pas : elles voient un lien mort, un résumé de quarante et un mots,
// pas un chiffre faux, pas un titre original tronqué, pas une analyse qui
// répète le résumé. Ce que la relecture d'un rédacteur en chef aurait fait,
// un second modèle peut le faire, à condition d'ouvrir les sources, ce qui
// coûte des appels, et le quota Google en a. La session qui rédige ne se
// relit pas elle-même : elle a le contexte de ses recherches sous les yeux,
// et relit ce qu'elle a cru lire. Un œil neuf lit la page.
//
// CE QUE LA RELECTURE NE PEUT PAS FAIRE, et que ce module fait respecter :
// ajouter un item, changer une adresse, vider le brief. Un modèle qui relit
// peut aussi halluciner, et le pire serait une adresse « corrigée ». D'où
// vérifierRelecture() : ce qui est rendu ne porte que des adresses reçues,
// pas plus d'items que reçus, et chaque retrait est nommé. Ce qui ne passe
// pas cette vérification n'est pas corrigé à la main : la relecture est
// refusée en bloc et le brief de la session part tel quel, ce qui est
// l'état d'avant, un état connu. Puis le contrôle avant vol, le même que la
// session a passé : une relecture qui ferait recaler le brief est refusée
// de même.
//
// Le module ne lance rien : la commande vit dans scripts/relecture.mjs.

import { extraireObjet } from './ombre.mjs';
import { cléAdresse } from './actualite.mjs';
import { similarity } from './guards.mjs';

/**
 * Au plus tant d'items retirés, et tant d'événements, par relecture.
 *
 * Un relecteur qui retire un item sur seize a lu une page qui ne disait pas
 * ce que le résumé disait ; un relecteur qui en retire six a perdu le fil,
 * ou lu six pages qui ne s'ouvraient pas. Le second cas est une panne, pas
 * un jugement, et une panne ne publie pas un brief amputé.
 */
export const MAX_RETRAITS = 3;

/** Les champs d'un item qu'une relecture peut changer, et que le rapport compare. */
const CHAMPS_ITEM = ['headline', 'original_headline', 'summary', 'analysis', 'importance', 'tags', 'source_name', 'source_lang', 'published_at'];
const CHAMPS_EVENT = ['name', 'kind', 'theme', 'venue', 'area', 'start_date', 'end_date', 'summary', 'source_name', 'source_lang', 'address'];

/**
 * La consigne de relecture, remplie : le jour et le brief entier.
 *
 * Le brief est dans la consigne, et non lu dans le dépôt : Gemini n'a alors
 * besoin que d'ouvrir des pages, la permission `read_file` ne compte pas, et
 * c'est elle qui a fait rater l'ombre le 18 septembre 2026.
 *
 * @param {string} gabarit      prompts/relecture.md
 * @param {object} p
 * @param {string} p.jour
 * @param {object} p.brief
 */
export function composerConsigneRelecture(gabarit, { jour, brief }) {
  return gabarit.replaceAll('{{JOUR}}', jour).replaceAll('{{BRIEF}}', JSON.stringify(brief, null, 2));
}

/**
 * Ce que Gemini a rendu : `corrections`, une liste, et `brief`, un objet.
 *
 * Un relecteur qui rend le brief nu, sans l'enveloppe, a tout de même relu :
 * on le prend, avec une liste de corrections vide, et le rapport dira les
 * écarts qu'il calcule lui-même. Ce qui n'est ni l'un ni l'autre est une
 * panne.
 *
 * @param {string} texte
 * @returns {{ corrections: object[], brief: object }}
 */
export function extraireRelecture(texte) {
  const objet = extraireObjet(texte);
  // Un relecteur qui a retiré le dernier événement rend `events: []`, que
  // le schéma refuse : la clé s'omet, comme le prompt le demande à l'agent.
  const sansEventsVides = (brief) => (Array.isArray(brief.events) && brief.events.length === 0 ? (({ events, ...reste }) => reste)(brief) : brief);
  if (objet.brief && typeof objet.brief === 'object' && !Array.isArray(objet.brief)) {
    const corrections = Array.isArray(objet.corrections) ? objet.corrections.filter((c) => c && typeof c === 'object') : [];
    return { corrections, brief: sansEventsVides(vérifierListes(objet.brief)) };
  }
  if (Array.isArray(objet.sections)) return { corrections: [], brief: sansEventsVides(vérifierListes(objet)) };
  throw new Error('la réponse ne porte ni `brief` ni `sections`');
}

// Le 21 septembre 2026, Gemini a rendu `sections` en objet, et non en
// liste : tout ce qui suit parcourt des listes, et la première boucle a
// fait tomber le script, sans rapport et sans dire ce qu'il avait reçu.
// Une forme qui n'est pas celle du brief est une panne, dite ici, avant
// que quiconque parcoure quoi que ce soit.
function vérifierListes(brief) {
  const liste = (v, nom) => {
    if (v !== undefined && !Array.isArray(v)) throw new Error(`le brief rendu porte \`${nom}\` en ${v === null ? 'null' : typeof v}, pas en liste`);
  };
  liste(brief.sections, 'sections');
  liste(brief.events, 'events');
  for (const [n, s] of (brief.sections ?? []).entries()) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`le brief rendu porte une section qui n'est pas un objet (${n})`);
    liste(s.items, `sections[${n}].items`);
  }
  return brief;
}

const ADRESSES_EVENT = ['source_url', 'booking_url', 'map_url'];

const adressesDe = (brief) => {
  const adresses = new Set();
  for (const s of brief?.sections ?? []) for (const i of s.items ?? []) if (i.source_url) adresses.add(i.source_url);
  for (const e of brief?.events ?? []) for (const champ of ADRESSES_EVENT) if (e[champ]) adresses.add(e[champ]);
  return adresses;
};

const itemsDe = (brief) => (brief?.sections ?? []).flatMap((s) => (s.items ?? []).map((item) => ({ section: s.key, item })));

/**
 * Les adresses reçues, rétablies à la lettre dans le brief rendu.
 *
 * Le 18 septembre 2026, à l'essai, Gemini a rendu l'adresse TechCrunch avec
 * une barre de plus en fin (`…behavior//`) : le même article, une autre
 * chaîne, et la vérification l'aurait tenue pour inventée. Une adresse qui
 * ne diffère de la reçue que par la forme, barre finale, `utm`, ancre, est
 * la reçue : on remet celle-ci, à la lettre, et la vérification qui suit
 * reste stricte. Une adresse vraiment autre reste autre, et sera refusée.
 *
 * @param {object} original
 * @param {object} relu       modifié en place, et rendu
 */
export function rétablirAdresses(original, relu) {
  const exactes = adressesDe(original);
  const parClé = new Map([...exactes].map((a) => [cléAdresse(a), a]));
  const rétablir = (objet, champ) => {
    const a = objet?.[champ];
    if (typeof a !== 'string' || exactes.has(a)) return;
    const exacte = parClé.get(cléAdresse(a));
    if (exacte !== undefined) objet[champ] = exacte;
  };
  for (const s of relu?.sections ?? []) for (const i of s.items ?? []) rétablir(i, 'source_url');
  for (const e of relu?.events ?? []) for (const champ of ADRESSES_EVENT) rétablir(e, champ);
  return relu;
}

/**
 * Les heures reçues, rétablies quand le relecteur n'a fait que les
 * réécrire dans un autre fuseau.
 *
 * À l'essai du 18 septembre 2026, Gemini a rendu `2026-09-17T13:34:24-07:00`
 * pour `2026-09-18T05:34:24+09:00` : le même instant, à l'heure de la
 * page, quand le brief parle à l'heure de Séoul. Même instant, même
 * chaîne, la reçue ; un instant différent est une correction, et reste.
 *
 * @param {object} original
 * @param {object} relu       modifié en place, et rendu
 */
export function rétablirHeures(original, relu) {
  const mêmeInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== b && Date.parse(a) === Date.parse(b);
  const itemsO = itemsDe(original).map(({ item }) => item);
  const itemsR = itemsDe(relu).map(({ item }) => item);
  apparier(itemsO, itemsR, (i) => i.headline ?? '').forEach((rendu, n) => {
    if (rendu && mêmeInstant(itemsO[n].published_at, rendu.published_at)) rendu.published_at = itemsO[n].published_at;
  });
  return relu;
}

/**
 * Chaque élément reçu, et celui qui lui répond dans le brief rendu, ou
 * `null` s'il a été retiré.
 *
 * Par l'adresse d'abord, la seule chose qu'une relecture ne change pas ;
 * puis, entre plusieurs éléments à la même adresse, par le titre le plus
 * ressemblant. Deux événements peuvent venir de la même page, un
 * programme de la ville en annonce dix, et le 18 septembre 2026 deux
 * événements du brief partageaient leur source : appariés à l'adresse
 * seule, l'un passait pour l'autre et la relecture semblait avoir changé
 * son nom, son lieu et ses dates.
 *
 * @param {object[]} reçus
 * @param {object[]} rendus
 * @param {(x: object) => string} titre
 * @returns {(object|null)[]}   dans l'ordre des reçus
 */
function apparier(reçus, rendus, titre) {
  // Toutes les paires possibles à la même adresse, les plus ressemblantes
  // d'abord, chacun servi une fois : le premier retiré d'une page qui en
  // sourçait deux ne prend pas la place du second.
  const paires = [];
  reçus.forEach((reçu, i) => {
    const clé = cléAdresse(reçu.source_url);
    rendus.forEach((rendu, j) => {
      if (cléAdresse(rendu.source_url) === clé) paires.push({ i, j, score: similarity(titre(reçu), titre(rendu)) });
    });
  });
  paires.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  const résultat = reçus.map(() => null);
  const pris = new Set();
  for (const { i, j } of paires) {
    if (résultat[i] !== null || pris.has(j)) continue;
    résultat[i] = rendus[j];
    pris.add(j);
  }
  return résultat;
}

/**
 * La relecture n'a-t-elle fait que relire ?
 *
 * Rend la liste des raisons de la refuser ; vide, elle est acceptable, et
 * c'est au contrôle avant vol de dire le reste. Les règles sont celles de la
 * consigne, mais une consigne se contourne et ceci non : même date, mêmes
 * sections dans le même ordre, aucune adresse qui n'ait été reçue, pas plus
 * d'items ni d'événements que reçus, pas plus de retraits que MAX_RETRAITS,
 * et autant de retraits nommés dans `corrections` que de retraits constatés.
 *
 * @param {object} original     le brief de la session
 * @param {{ corrections: object[], brief: object }} relecture
 * @returns {string[]}
 */
export function vérifierRelecture(original, { corrections = [], brief: relu }) {
  const raisons = [];
  if (!relu || !Array.isArray(relu.sections)) return ['le brief rendu n\'a pas de sections'];
  if (relu.date !== original.date) raisons.push(`la date a changé : ${original.date} → ${relu.date}`);

  const clésO = (original.sections ?? []).map((s) => s.key);
  const clésR = relu.sections.map((s) => s.key);
  if (clésO.join(',') !== clésR.join(',')) raisons.push(`les sections ont changé : ${clésO.join(', ')} → ${clésR.join(', ')}`);

  const reçues = adressesDe(original);
  const inconnues = [...adressesDe(relu)].filter((a) => !reçues.has(a));
  if (inconnues.length) raisons.push(`adresse(s) qui n'étaient pas dans le brief reçu : ${inconnues.join(', ')}`);

  const itemsO = itemsDe(original).map(({ item }) => item);
  const itemsR = itemsDe(relu).map(({ item }) => item);
  if (itemsR.length > itemsO.length) raisons.push(`plus d'items qu'à la réception : ${itemsO.length} → ${itemsR.length}`);
  const retirés = apparier(itemsO, itemsR, (i) => i.headline ?? '').filter((r) => r === null).length;
  if (retirés > MAX_RETRAITS) raisons.push(`${retirés} items retirés, ${MAX_RETRAITS} au plus`);

  const eventsO = original.events ?? [];
  const eventsR = relu.events ?? [];
  if (eventsR.length > eventsO.length) raisons.push(`plus d'événements qu'à la réception : ${eventsO.length} → ${eventsR.length}`);
  const eventsRetirés = apparier(eventsO, eventsR, (e) => e.name ?? '').filter((r) => r === null).length;
  if (eventsRetirés > MAX_RETRAITS) raisons.push(`${eventsRetirés} événements retirés, ${MAX_RETRAITS} au plus`);

  const retraitsNommés = corrections.filter((c) => /^(item|event|événement|evenement)$/i.test(String(c.champ ?? ''))).length;
  const retraits = retirés + eventsRetirés;
  if (retraits > retraitsNommés) raisons.push(`${retraits} retrait(s) constaté(s), ${retraitsNommés} expliqué(s) dans corrections`);

  return raisons;
}

const pareil = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Ce qui a changé entre le brief reçu et le brief rendu, calculé, et non
 * lu dans `corrections` : le relecteur dit pourquoi, le dépôt dit quoi, et
 * le rapport met les deux côte à côte. Les items se suivent à l'adresse,
 * la seule chose qu'une relecture ne change pas.
 *
 * @returns {{ cible: string, champ: string, avant: unknown, après: unknown }[]}
 */
export function écarts(original, relu) {
  const liste = [];
  for (const champ of ['title', 'standfirst']) {
    if (!pareil(original[champ], relu[champ])) liste.push({ cible: champ, champ, avant: original[champ], après: relu[champ] });
  }
  const reçus = itemsDe(original);
  const rendus = itemsDe(relu);
  const appariés = apparier(reçus.map(({ item }) => item), rendus.map(({ item }) => item), (i) => i.headline ?? '');
  reçus.forEach(({ section, item }, n) => {
    const cible = `${section}/${item.importance}`;
    const après = appariés[n];
    if (!après) {
      liste.push({ cible, champ: 'item', avant: item.headline, après: null });
      return;
    }
    const sectionAprès = rendus.find((r) => r.item === après).section;
    if (sectionAprès !== section) liste.push({ cible, champ: 'section', avant: section, après: sectionAprès });
    for (const champ of CHAMPS_ITEM) {
      if (!pareil(item[champ], après[champ])) liste.push({ cible, champ, avant: item[champ], après: après[champ] });
    }
  });
  for (const s of original.sections ?? []) {
    const r = (relu.sections ?? []).find((x) => x.key === s.key);
    if (r && !pareil(s.empty_note, r.empty_note)) liste.push({ cible: `${s.key}/empty_note`, champ: 'empty_note', avant: s.empty_note, après: r.empty_note });
  }
  const eventsAppariés = apparier(original.events ?? [], relu.events ?? [], (e) => e.name ?? '');
  (original.events ?? []).forEach((e, i) => {
    const cible = `events/${i}`;
    const après = eventsAppariés[i];
    if (!après) {
      liste.push({ cible, champ: 'event', avant: e.name, après: null });
      return;
    }
    for (const champ of CHAMPS_EVENT) {
      if (!pareil(e[champ], après[champ])) liste.push({ cible, champ, avant: e[champ], après: après[champ] });
    }
    for (const champ of ['booking_url', 'map_url']) {
      if (e[champ] && !après[champ]) liste.push({ cible, champ, avant: e[champ], après: null });
    }
  });
  return liste;
}

const court = (v) => {
  if (v == null) return '—';
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
};

/**
 * Le rapport de relecture, en Markdown, pour le matin où l'on se demande
 * ce que Gemini a changé, et pour les matins où il n'a rien changé, ce qui
 * se lit aussi.
 *
 * @param {object} p
 * @param {string} p.jour
 * @param {'appliquée'|'sans changement'|'refusée'|'recalée'|'panne'} p.sort
 * @param {string} [p.raison]              pourquoi refusée, recalée ou en panne
 * @param {object[]} [p.corrections]       ce que Gemini dit avoir changé
 * @param {object[]} [p.écarts]            ce que le dépôt constate
 * @param {object} [p.session]             { modèle, durée, tours, usage }
 * @param {string} [p.verdict]             la sortie du contrôle avant vol
 */
export function rendreRapport({ jour, sort, raison, corrections = [], écarts: liste = [], session = {}, verdict }) {
  const lignes = [`# Relecture du ${jour}`, ''];
  lignes.push(
    `Gemini (${session.modèle ?? '?'}) : ${session.durée != null ? `${Math.round(session.durée)} s` : 'durée inconnue'}${session.tours ? `, ${session.tours} tours` : ''}${
      session.usage ? `, ${session.usage.input_tokens ?? '?'} tokens lus, ${session.usage.output_tokens ?? '?'} écrits` : ''
    }.`,
    `Relecture **${sort}**${raison ? ` : ${raison}` : ''}.`,
    ''
  );
  if (corrections.length) {
    lignes.push('## Ce que le relecteur dit avoir changé', '');
    for (const c of corrections) lignes.push(`- ${c.cible ?? '?'} · ${c.champ ?? '?'} : ${c.pourquoi ?? '(sans raison)'}`);
    lignes.push('');
  }
  if (liste.length) {
    lignes.push('## Ce qui a changé, constaté', '');
    for (const e of liste) {
      lignes.push(`- **${e.cible} · ${e.champ}**`);
      lignes.push(`  avant : ${court(e.avant)}`);
      lignes.push(`  après : ${court(e.après)}`);
    }
    lignes.push('');
  } else if (sort === 'sans changement') {
    lignes.push('Aucun écart entre le brief reçu et le brief rendu.', '');
  }
  if (verdict) lignes.push('## Contrôle avant vol du brief relu', '', '```', verdict.trim(), '```', '');
  return lignes.join('\n');
}
