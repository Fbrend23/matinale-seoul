// La relecture du brief AVANT sa publication : Gemini confronte chaque résumé à
// la page de sa source, corrige le français, et rend son lot ;
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
// PAR LOTS, ET NON D'UN BLOC. La première relecture, le 18 septembre 2026,
// recevait le brief entier et ouvrait ses vingt-sept pages dans une seule
// session : 2,4 millions de tokens lus, parce que chaque page ouverte est
// relue à chaque appel suivant, au carré du nombre de pages. C'est la leçon
// qui avait fait naître la veille RSS côté Claude, et elle vaut ici. Une
// session par rubrique, trois ou quatre pages chacune, plus une pour les
// événements, en parallèle : le même travail, cinq fois moins de tokens, et
// le quota Google, commun à tout ce que Gemini fait le matin, tient.
// Le titre et le chapeau ne sont pas relus : ils demanderaient le brief
// entier, et un chapeau juste le reste après une correction de résumé.
//
// LES PAGES SONT DANS LA CONSIGNE (lib/pages.mjs dit pourquoi). Une source que
// le dépôt n'a pas pu lire n'est pas relue : ce que le relecteur en a rendu
// est écarté, l'item reste celui de la session, et le rapport le nomme.
//
// Le module ne lance rien : la commande vit dans scripts/relecture.mjs.

import { randomBytes } from 'node:crypto';
import { cléAdresse } from './actualite.mjs';
import { tronquer } from './pages.mjs';
import { similarity } from './guards.mjs';
import { SECTION_LABELS } from '../../shared/sections.mjs';

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
 * L'objet JSON dans ce que Gemini a répondu : entre le premier `{` et le
 * dernier `}`, comme extraireTableau() pour la recherche. Ce qui ne s'analyse
 * pas est une panne, pas un lot vide.
 *
 * @param {string} texte
 * @returns {object}
 */
export function extraireObjet(texte) {
  const début = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (début < 0 || fin < début) throw new Error('aucun objet JSON dans la réponse');
  let objet;
  try {
    objet = JSON.parse(texte.slice(début, fin + 1));
  } catch (e) {
    throw new Error(`objet JSON illisible : ${e.message}`);
  }
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) throw new Error('la réponse n\'est pas un objet');
  return objet;
}

/**
 * Les lots d'un brief : une rubrique pourvue par lot, et les événements.
 *
 * Une rubrique vide n'a rien à relire, et un brief sans événements n'a pas
 * de lot pour eux. Chaque lot porte ce que la consigne en dit (`libellé`) et
 * ce que Gemini reçoit et doit rendre (`contenu`), de la même forme.
 *
 * @param {object} brief
 * @returns {{ nom: string, libellé: string, contenu: object }[]}
 */
export function lotsDe(brief) {
  const lots = [];
  for (const section of brief?.sections ?? []) {
    if (!section.items?.length) continue;
    lots.push({
      nom: section.key,
      libellé: `la rubrique « ${SECTION_LABELS[section.key] ?? section.key} » (\`${section.key}\`), ${section.items.length} item${section.items.length > 1 ? 's' : ''}`,
      contenu: { section },
    });
  }
  if (brief?.events?.length) {
    lots.push({ nom: 'events', libellé: `les événements, ${brief.events.length} fiche${brief.events.length > 1 ? 's' : ''}`, contenu: { events: brief.events } });
  }
  return lots;
}

/**
 * La consigne passe en argument de commande, et Linux refuse un argument de
 * plus de 131 072 octets : la consigne entière reste en dessous, avec une
 * marge.
 */
export const MAX_OCTETS_CONSIGNE = 120_000;

/** Au plus tant d'octets par page : au-delà, c'est le quota qu'on paie. */
export const MAX_OCTETS_PAGE = 16_000;

/** L'enveloppe d'une page : balises, adresse, titre, date. */
const OCTETS_ENVELOPPE = 1500;

/** Les adresses sources d'un lot, chacune une fois. */
export function sourcesDe(lot) {
  const éléments = lot.contenu.section?.items ?? lot.contenu.events ?? [];
  return [...new Set(éléments.map((e) => e.source_url).filter(Boolean))];
}

// Le texte d'une page est une donnée venue du dehors : il est enfermé entre des
// balises à jeton tiré au sort, qu'une page ne peut pas deviner pour s'en
// évader, et ses clôtures de code sont défaites pour que le lot reste le seul
// bloc de la consigne.
const désarmer = (t) => String(t).replaceAll('```', "'''");

function rendrePages(pages, budget, jeton) {
  const lisibles = pages.filter((p) => p.lisible);
  const parPage = Math.min(MAX_OCTETS_PAGE, Math.floor(budget / Math.max(1, lisibles.length)) - OCTETS_ENVELOPPE);
  const blocs = lisibles.map((p) => {
    const { texte, tronqué } = tronquer(désarmer(p.texte), parPage);
    return [
      `<page-${jeton}>`,
      `source_url : ${p.url}`,
      `titre affiché : ${désarmer(tronquer(p.titre ?? '(aucun)', 400).texte)}`,
      `publication affichée : ${désarmer(tronquer(p.publié ?? '(non trouvée)', 80).texte)}`,
      tronqué ? 'texte : TRONQUÉ, la fin de la page manque' : 'texte :',
      texte,
      `</page-${jeton}>`,
    ].join('\n');
  });
  const absentes = pages.filter((p) => !p.lisible);
  if (absentes.length) {
    blocs.push(`Sources NON FOURNIES, que tu rends exactement telles que reçues :\n${absentes.map((p) => `- ${p.url}`).join('\n')}`);
  }
  return blocs.join('\n\n');
}

/**
 * La consigne d'un lot, remplie : le jour, ce qu'est le lot, les pages de ses
 * sources, et le lot.
 *
 * Tout est dans la consigne : Gemini n'a besoin d'aucun outil, donc d'aucune
 * permission, et ne peut rien dire d'une page qu'on ne lui a pas donnée sans
 * l'inventer.
 *
 * @param {string} gabarit      prompts/relecture.md
 * @param {object} p
 * @param {string} p.jour
 * @param {{ libellé: string, contenu: object }} p.lot
 * @param {{ url: string, lisible: boolean, titre?: string|null, publié?: string|null, texte?: string }[]} [p.pages]
 * @param {string} [p.jeton]
 */
export function composerConsigneRelecture(gabarit, { jour, lot, pages = [], jeton = randomBytes(6).toString('hex') }) {
  // Remplacés d'un seul passage, et par une fonction : ni les `$` d'une page ni
  // un `{{CONTENU}}` qu'elle écrirait ne sont interprétés.
  const remplir = (valeurs) => gabarit.replace(/\{\{(JOUR|LOT|JETON|CONTENU|PAGES)\}\}/g, (_, clé) => valeurs[clé]);
  const valeurs = { JOUR: jour, LOT: lot.libellé, JETON: jeton, CONTENU: JSON.stringify(lot.contenu, null, 2), PAGES: '' };
  const budget = MAX_OCTETS_CONSIGNE - Buffer.byteLength(remplir(valeurs));
  return remplir({ ...valeurs, PAGES: rendrePages(pages, budget, jeton) });
}

/**
 * Ce que Gemini a rendu pour un lot : `corrections`, une liste, et `lot`,
 * de la forme reçue, `{ section }` ou `{ events }`.
 *
 * Un relecteur qui rend le contenu nu, sans l'enveloppe, ou la section
 * seule sans sa clé `section`, a tout de même relu : on le prend, et le
 * rapport dira les écarts qu'il calcule lui-même. Ce qui n'est rien de
 * tout cela est une panne.
 *
 * @param {string} texte
 * @returns {{ corrections: object[], lot: object }}
 */
export function extraireRelecture(texte) {
  const objet = extraireObjet(texte);
  const corrections = Array.isArray(objet.corrections) ? objet.corrections.filter((c) => c && typeof c === 'object') : [];
  const candidats = [objet.lot, objet, objet.section && { section: objet.section }, Array.isArray(objet.events) && { events: objet.events }];
  for (const c of candidats) {
    if (!c || typeof c !== 'object') continue;
    if (c.section && typeof c.section === 'object' && !Array.isArray(c.section)) return { corrections, lot: vérifierListes({ section: c.section }) };
    if (c.events !== undefined) return { corrections, lot: vérifierListes({ events: c.events }) };
  }
  if (typeof objet.key === 'string' && objet.items !== undefined) return { corrections, lot: vérifierListes({ section: objet }) };
  throw new Error('la réponse ne porte ni `section` ni `events`');
}

// Le 21 septembre 2026, Gemini a rendu `sections` en objet, et non en
// liste : tout ce qui suit parcourt des listes, et la première boucle a
// fait tomber le script, sans rapport et sans dire ce qu'il avait reçu.
// Une forme qui n'est pas celle du lot est une panne, dite ici, avant que
// quiconque parcoure quoi que ce soit.
function vérifierListes(lot) {
  const liste = (v, nom) => {
    if (!Array.isArray(v)) throw new Error(`le lot rendu porte \`${nom}\` en ${v === null ? 'null' : typeof v}, pas en liste`);
  };
  if (lot.section) liste(lot.section.items, 'section.items');
  else liste(lot.events, 'events');
  return lot;
}

/**
 * Le brief recomposé : les lots relus prennent la place des reçus, ce qui
 * n'a pas été relu, lot en panne, rubrique vide, titre, chapeau, reste tel
 * quel. Une section rendue sous une autre clé que la sienne est ignorée :
 * un relecteur qui se trompe de rubrique n'en remplace pas une autre.
 *
 * @param {object} original
 * @param {Map<string, object>} relus     nom du lot → lot rendu
 * @returns {object}
 */
export function recomposer(original, relus) {
  const brief = JSON.parse(JSON.stringify(original));
  brief.sections = brief.sections.map((section) => {
    const relu = relus.get(section.key)?.section;
    return relu && relu.key === section.key ? { ...section, ...relu, key: section.key } : section;
  });
  const events = relus.get('events')?.events;
  if (events) {
    // Un relecteur qui a retiré le dernier événement rend `[]`, que le
    // schéma refuse : la clé s'omet, comme le prompt le demande à l'agent.
    if (events.length) brief.events = events;
    else delete brief.events;
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
 * Ce que le relecteur n'a pas pu lire, remis tel que reçu.
 *
 * La consigne le demande ; ceci l'impose. Un item dont la source n'a pas été
 * fournie ne peut être ni corrigé ni retiré : il n'y a rien pour le justifier.
 * Il revient à sa place, entier. Les rangs ne sont resserrés que s'ils ne
 * tiennent plus, et la section ne garde pas deux analyses.
 *
 * @param {object} original
 * @param {object} relu              modifié en place, et rendu
 * @param {Set<string>} nonRelues    les `source_url` non relues, telles que reçues
 */
export function restaurerNonLus(original, relu, nonRelues) {
  const clés = new Set([...nonRelues].map(cléAdresse));
  const estNonLu = (x) => Boolean(x?.source_url) && clés.has(cléAdresse(x.source_url));
  const copie = (x) => JSON.parse(JSON.stringify(x));
  const replacer = (reçus, rendus) => {
    const liste = rendus.filter((x) => !estNonLu(x));
    reçus.forEach((x, i) => {
      if (estNonLu(x)) liste.splice(Math.min(i, liste.length), 0, copie(x));
    });
    return liste;
  };

  for (const section of relu?.sections ?? []) {
    const reçue = (original.sections ?? []).find((s) => s.key === section.key);
    if (!reçue || !Array.isArray(section.items)) continue;
    const gardés = reçue.items.filter(estNonLu);
    if (!gardés.length && !section.items.some(estNonLu)) continue;
    section.items = replacer(reçue.items, section.items);
    if (!gardés.length) continue;
    section.empty_note = reçue.empty_note;
    if (reçue.empty_note === undefined) delete section.empty_note;
    if (gardés.some((i) => i.analysis)) {
      const sansAnalyse = new Set(reçue.items.filter((i) => !i.analysis).map((i) => cléAdresse(i.source_url)));
      for (const i of section.items) if (!estNonLu(i) && sansAnalyse.has(cléAdresse(i.source_url))) delete i.analysis;
    }
    const rangs = section.items.map((i) => i.importance).sort((a, b) => a - b);
    if (rangs.some((r, n) => r !== n + 1)) {
      [...section.items].sort((a, b) => a.importance - b.importance).forEach((i, n) => { i.importance = n + 1; });
    }
  }

  if ((original.events ?? []).some(estNonLu) || (relu?.events ?? []).some(estNonLu)) {
    const events = replacer(original.events ?? [], relu.events ?? []);
    if (events.length) relu.events = events;
    else delete relu.events;
  }
  return relu;
}

/** La cible d'une correction, `section/rang` ou `events/index`, vise-t-elle une source non relue ? */
export function visesNonLue(original, correction, nonRelues) {
  const [où, n] = String(correction?.cible ?? '').split('/');
  const élément = où === 'events'
    ? original.events?.[Number(n)]
    : original.sections?.find((s) => s.key === où)?.items?.find((i) => i.importance === Number(n));
  return Boolean(élément) && nonRelues.has(élément.source_url);
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
 * @param {object} [p.session]             { modèle, durée, tours, usage, lots, pannes }
 * @param {string} [p.verdict]             la sortie du contrôle avant vol
 * @param {{ total: number, nonRelues: { url: string, raison: string }[] }} [p.sources]
 */
export function rendreRapport({ jour, sort, raison, corrections = [], écarts: liste = [], session = {}, verdict, sources }) {
  const manquantes = sources?.nonRelues ?? [];
  const lignes = [`# Relecture du ${jour}`, ''];
  lignes.push(
    `Gemini (${session.modèle ?? '?'}) : ${session.durée != null ? `${Math.round(session.durée)} s` : 'durée inconnue'}${session.tours ? `, ${session.tours} tours` : ''}${
      session.usage ? `, ${session.usage.input_tokens ?? '?'} tokens lus, ${session.usage.output_tokens ?? '?'} écrits` : ''
    }.`,
    ...(session.lots ? [`${session.lots} lot(s)${session.pannes?.length ? `, ${session.pannes.length} non relu(s) : ${session.pannes.join(' ; ')}` : ', tous relus'}.`] : []),
    // « Sans changement » ne se dit jamais d'un brief relu en partie sans le
    // dire dans la même phrase : c'est ce mot seul qui a menti cinq semaines.
    `Relecture **${manquantes.length && sort !== 'panne' ? 'partielle, ' : ''}${sort}**${raison ? ` : ${raison}` : ''}.`,
    ...(sources ? [`Sources : ${sources.total - manquantes.length} relue(s) sur ${sources.total}.`] : []),
    ''
  );
  if (manquantes.length) {
    lignes.push('## Sources NON relues : publiées telles que la session les a écrites', '');
    for (const s of manquantes) lignes.push(`- ${s.url} : ${s.raison}`);
    lignes.push('');
  }
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
    lignes.push(`Aucun écart entre le brief reçu et le brief rendu${manquantes.length ? ' sur les sources relues' : ''}.`, '');
  }
  if (verdict) lignes.push('## Contrôle avant vol du brief relu', '', '```', verdict.trim(), '```', '');
  return lignes.join('\n');
}
