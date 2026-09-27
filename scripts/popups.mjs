#!/usr/bin/env node
// Le registre des pop-ups du matin : énuméré, diffé contre l'onglet, déposé
// dans la veille.
//
//   node scripts/popups.mjs                     # le jour courant à Séoul
//   node scripts/popups.mjs --jour 2026-09-19
//   node scripts/popups.mjs --json              # les retenus sur la sortie,
//                                               # rien d'écrit (remplissage en lot)
//   node scripts/popups.mjs --max 10            # n'en lire que dix, pour essayer
//
// Tourne APRÈS scripts/veille.mjs, dont il complète le fichier, et AVANT
// scripts/recherche.mjs, qui lit son instantané pour ne pas faire chercher à
// Gemini ce que le registre vient de rendre.
//
// AUCUN MODÈLE ICI, ET C'EST TOUT L'INTÉRÊT. Une recherche échantillonne ; une
// énumération couvre. scripts/lib/popups.mjs dit pourquoi le registre se prête
// à l'exercice (du JSON-LD sur chaque fiche) et ce qui reste au rédacteur (le
// nom français et le résumé).
//
// Rien ici n'est bloquant pour la parution : registre injoignable, la veille le
// dit, et les pistes de Gemini restent.

import { readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { connusDuSite } from './lib/onglet.mjs';
import { trierPistes } from './lib/recherche.mjs';
import {
  récolter,
  déjàDansOnglet,
  motsGénériques,
  fetcheurDeCache,
  rendreRegistre,
  REGISTRES,
  MISES_EN_AVANT,
  àSauter,
  retenirÉcartées,
} from './lib/popups.mjs';
import { rangsDeSources } from './lib/sources.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const jour = option('--jour') ?? seoulToday();
const dossier = path.resolve(RACINE, option('--dossier') ?? 'veille');
const max = Number(option('--max') ?? Infinity);
const enAvant = Number(option('--avant') ?? MISES_EN_AVANT);
const versLaSortie = args.includes('--json');

// Presse + officiels : un pop-up peut être sourcé chez celui qui l'organise
// (lib/sources.mjs). Le registre lui-même est dans la presse.
const { pourÉvénements, agrégateurs } = rangsDeSources(
  JSON.parse(readFileSync(path.join(RACINE, 'config/sources.json'), 'utf8'))
);

const journal = (...m) => {
  if (!versLaSortie) console.log(...m);
};

await mkdir(dossier, { recursive: true });
const sortie = path.join(dossier, `${jour}.md`);
const instantané = path.join(dossier, `popups-${jour}.json`);
// Ce que les registres à mémoire ont écarté les matins précédents, par hôte
// (NEMONE.mémoire). Perdue, elle se refait : un matin plus long, rien de faux.
const cheminMémoire = path.join(dossier, 'registres-lus.json');
const mémoire = await readFile(cheminMémoire, 'utf8').then(JSON.parse, () => ({}));

// La veille est censée être là. Sinon, la section fait un fichier à elle seule,
// avec un titre : l'agent lit le même chemin dans les deux cas.
async function déposer(section) {
  if (versLaSortie) return;
  const existe = await access(sortie).then(() => true, () => false);
  if (existe) await appendFile(sortie, `\n${section}`);
  else await writeFile(sortie, `# Veille du ${jour} (heure de Séoul), flux non relevés\n\n${section}`);
}

// --- L'onglet, d'abord : sans lui, il n'y a pas de diff ----------------------
//
// Et sans diff, pas de section : reproposer les quatre-vingts événements déjà
// en ligne serait pire que ne rien proposer. Le matin d'un incident du site,
// le registre se tait donc, et le dit.
const { connus, panne: panneSite } = await connusDuSite();
journal(`${panneSite ? '!' : '✓'} ${'evenements.json'.padEnd(18)} ${panneSite ?? `${connus.length} événements connus`}`);
if (panneSite) {
  await déposer(rendreRegistre({ jour, panne: `l'onglet est injoignable (${panneSite}), le diff serait faux` }));
  process.exit(1);
}

// --- Les registres -----------------------------------------------------------
//
// Ensemble : ils tiennent des listes différentes (Inside Seoul les pop-ups de
// quartier, NOL World les concerts, expositions à billet et pop-ups d'idols),
// et l'un en panne est un registre en moins, pas une matinée sans section.
const début = Date.now();
const récoltes = [];
const pannesDeRegistre = [];
for (const registre of REGISTRES) {
  try {
    const sauter = registre.mémoire ? àSauter(mémoire[registre.hôte], jour) : new Set();
    const récolte = await récolter({ registre, max, sauter });
    const durée = Math.round((Date.now() - début) / 1000);
    const passées = récolte.sautées ? `, ${récolte.sautées} déjà écartées un autre matin` : '';
    journal(`✓ ${registre.nom.padEnd(18)} ${récolte.candidats.length} fiches lues sur ${récolte.fiches} en ${durée} s${passées}`);
    if (registre.mémoire) mémoire[registre.hôte] = retenirÉcartées(mémoire[registre.hôte], récolte, jour);
    // Ce que la règle écarte se compte, ce qui ne se lit pas se nomme : vingt
    // fiches sans date de fin sont un fait du registre, pas vingt pannes.
    const parRaison = new Map();
    for (const { raison } of récolte.écartées) parRaison.set(raison, (parRaison.get(raison) ?? 0) + 1);
    for (const [raison, n] of parRaison) journal(`  · ${n} ${raison}`);
    for (const { url, raison } of récolte.pannes) journal(`  ! ${url} : ${raison}`);
    récoltes.push(récolte);
  } catch (e) {
    journal(`! ${registre.nom.padEnd(18)} ${e.message}`);
    pannesDeRegistre.push(`${registre.nom} : ${e.message}`);
  }
}
await writeFile(cheminMémoire, `${JSON.stringify(mémoire)}\n`);
if (!récoltes.length) {
  await déposer(rendreRegistre({ jour, registres: REGISTRES, panne: pannesDeRegistre.join(' ; ') }));
  process.exit(1);
}
const récolte = {
  candidats: récoltes.flatMap((r) => r.candidats),
  fiches: récoltes.reduce((n, r) => n + r.fiches, 0),
  parRègle: récoltes.map((r) => ({ registre: r.registre.nom, n: r.écartées.length })).filter(({ n }) => n),
  pannes: récoltes.flatMap((r) => r.pannes),
  vues: new Map(récoltes.flatMap((r) => [...r.vues])),
};

// --- Le diff : ce que l'onglet tient déjà ------------------------------------
const neuves = [];
const déjàVues = [];
// Les mots trop partagés, calculés UNE FOIS sur l'onglet : soixante fiches
// contre quatre-vingt-seize événements, ce serait sinon six mille signatures
// recalculées.
const génériques = motsGénériques(connus);
for (const candidat of récolte.candidats) {
  const trouvé = déjàDansOnglet(candidat.event, connus, { génériques });
  if (trouvé) {
    déjàVues.push({ event: candidat.event, raison: `${trouvé.preuve} : « ${String(trouvé.connu.name).slice(0, 60)} »` });
    continue;
  }
  // Et le doublon ENTRE REGISTRES : le pop-up Pokémon de Seongsu est chez les
  // deux, sous deux noms anglais différents. Le premier rendu reste, et
  // REGISTRES est ordonné pour que ce soit celui qui donne le hangul.
  const double = déjàDansOnglet(candidat.event, neuves.map(({ event }) => event), { génériques });
  if (double) {
    déjàVues.push({ event: candidat.event, raison: `déjà rendu par l'autre registre (${double.preuve})` });
    continue;
  }
  neuves.push(candidat);
}
journal(`  ${neuves.length} neuves, ${déjàVues.length} déjà dans l'onglet`);

// --- Les gardes, sans resonder ce qu'on vient de lire ------------------------
//
// Le même tri que l'ingestion fera subir à l'événement (cohérence, allowlist,
// doublons, lien vivant), avec deux réglages que l'énumération impose : le
// plafond par domaine ne borne plus rien ici (tout vient du registre), et les
// sondes répondent du cache des pages lues il y a dix secondes.
const cache = fetcheurDeCache(récolte.vues);
const tri = await trierPistes(neuves.map(({ event }) => event), {
  domaines: pourÉvénements,
  agrégateurs,
  connus,
  today: jour,
  fetcher: cache,
  maxParSource: Infinity,
});

const matièreDe = new Map(neuves.map(({ event, matière }) => [event.source_url, matière]));
const adresseDe = new Map(neuves.map(({ event, adresse }) => [event.source_url, adresse]));
const retenues = tri.retenues.map((event) => ({ event, matière: matièreDe.get(event.source_url) ?? '' }));

// CE À QUOI IL NE MANQUE QUE LE LIEU. NOL World romanise ses lieux, et la
// table des salles ne peut pas tout connaître : un concert écarté pour ce seul
// motif est un concert perdu que personne d'autre n'annonce, alors que le nom
// coréen se trouve en une recherche. Il sort donc à part, avec son adresse
// romanisée, et la veille demande de le compléter. Les autres motifs — date
// passée, pas de date de fin, doublon — restent des rejets, eux.
const HANGUL_SEUL = /^lieu sans hangul/;
const àCompléter = [];
// CE QUE SEUL UN REGISTRE NON CITABLE A VU (NEMONE). L'allowlist l'écarte
// comme agrégateur, et c'est juste ; mais le jeter perdrait la seule trace
// d'un pop-up que personne d'autre ne tient. Il sort « à sourcer ».
const nonCitables = new Map(
  récoltes
    .filter((r) => r.registre.citable === false)
    .flatMap((r) => r.candidats.map(({ event }) => [event.source_url, r.registre.nom]))
);
const AGRÉGATEUR = /^agrégateur/;
const àSourcer = [];
const écartéesVraies = [];
for (const { event, raison } of tri.écartées) {
  if (HANGUL_SEUL.test(raison)) àCompléter.push({ event, adresse: adresseDe.get(event.source_url) ?? null });
  else if (AGRÉGATEUR.test(raison) && nonCitables.has(event.source_url)) {
    àSourcer.push({ event, registre: nonCitables.get(event.source_url) });
  } else écartéesVraies.push({ event, raison });
}
for (const { event } of retenues) journal(`  ✓ ${event.name} · ${event.theme ?? 'thème à trancher'} · ${event.start_date} → ${event.end_date}`);
for (const { event, connu } of tri.prolongées) journal(`  ↻ ${connu.name} : ${event.start_date} → ${event.end_date}`);
for (const { event } of àCompléter) journal(`  ? ${event.name} : lieu à mettre en coréen (« ${event.venue} »)`);
for (const { event } of àSourcer) journal(`  ~ ${event.name} : à sourcer (${event.start_date} → ${event.end_date})`);
for (const { event, raison } of écartéesVraies) journal(`  ! ${event.name ?? '(sans nom)'} : ${raison}`);

// --- Le dépôt ----------------------------------------------------------------
if (versLaSortie) {
  // Le lot, tel quel, pour un remplissage hors brief : `summary` manque, c'est
  // au rédacteur du lot de l'écrire, et le harnais du dépôt (ajv +
  // contrôlerÉvénements + POST) le refusera tant qu'il manque. C'est voulu.
  console.log(JSON.stringify(retenues.map(({ event, matière }) => ({ ...event, matière })), null, 2));
  process.exit(0);
}

await déposer(
  rendreRegistre({
    candidats: retenues,
    // Ce que NEMONE rend de connu, de fini ou d'incohérent ne se liste pas :
    // des dizaines de lignes sur des fiches que personne ne proposera, qu'on
    // ne cite pas. Le journal les nomme.
    écartées: [...déjàVues, ...écartéesVraies].filter(({ event }) => !nonCitables.has(event.source_url)),
    àCompléter,
    àSourcer,
    parRègle: récolte.parRègle,
    pannes: [...récolte.pannes, ...pannesDeRegistre.map((panne) => ({ url: '', raison: panne }))],
    fiches: récolte.fiches,
    jour,
    registres: REGISTRES,
    max: enAvant,
  })
);

// L'instantané, pour scripts/recherche.mjs : ce que le registre vient de rendre
// s'ajoute aux « connus » de la consigne de Gemini et de ses gardes. Sans lui,
// les deux scripts proposeraient le même pop-up dans deux sections de la même
// veille, l'un par le registre, l'autre par la rédaction qui en a parlé.
await writeFile(instantané, `${JSON.stringify(retenues.map(({ event }) => event), null, 2)}\n`);

journal(
  `registre écrit : ${path.relative(RACINE, sortie)} (${retenues.length} retenues, dont ${Math.min(enAvant, retenues.length)} en avant ; instantané ${path.relative(RACINE, instantané)})`
);
