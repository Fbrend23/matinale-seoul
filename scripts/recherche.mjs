#!/usr/bin/env node
// La recherche d'événements du matin : Gemini cherche, le dépôt trie, la veille
// reçoit une section « Pistes événements » que la session de rédaction lit.
//
//   node scripts/recherche.mjs                  # le jour courant à Séoul
//   node scripts/recherche.mjs --jour 2026-09-15
//
// Tourne APRÈS scripts/veille.mjs, dont il complète le fichier, et avant la
// session Claude. Deux sessions Gemini en parallèle, l'une sur les pages qui
// listent, l'autre sur les rédactions coréennes (VOLETS, dans lib/recherche.mjs
// dit pourquoi deux), interrogées par Antigravity CLI (`agy`), le
// successeur de Gemini CLI, abandonné pour les comptes individuels le
// 18 juin 2026, en headless, sur l'abonnement Google du compte connecté. Il
// répond un tableau JSON qu'il ne dépose nulle part : c'est ce script qui
// écrit, après tri.
//
// Rien ici n'est bloquant pour la parution. Gemini absent, muet ou hors quota,
// la section le dit et l'agent cherche lui-même, avec son budget. Le code de
// sortie dit si Gemini a répondu quelque chose de lisible : le lanceur le
// journalise, il ne s'arrête pas dessus.
//
//   MATINALE_GEMINI=/chemin/vers/un/faux      une autre commande, pour essayer sans quota
//   MATINALE_GEMINI_MODELE=…                 un autre modèle (`agy models` les liste)

import { readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { composerConsigne, extraireTableau, trierPistes, rendrePistes, VOLETS } from './lib/recherche.mjs';
import { interrogerGemini } from './lib/agy.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const SITE = (process.env.SITE_URL ?? 'https://matinale.brendanfleurdelys.ch').replace(/\/$/, '');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Le modèle est FIXÉ ET JOURNALISÉ, pour la raison que bin/brief-du-jour.sh
// donne pour Claude : deux matins sur deux modèles différents sans que rien
// ne le dise, c'est une baisse de qualité impossible à rattacher à sa cause.
// Un Flash, parce que la recherche est bornée par le temps, pas par la
// finesse. Le 3.6 en « medium » et non le 3.8 en « high », depuis le
// 18 septembre 2026 : le quota individuel, commun à tout ce que Gemini fait
// le matin, s'est vidé en une matinée d'essais (429, RESOURCE_EXHAUSTED), et
// chercher n'est pas juger, c'est la relecture qui garde le 3.8 en « high »
// (scripts/relecture.mjs). Même réglage pour l'actualité et l'ombre. `agy
// models` liste ce qui existe.
const MODELE = process.env.MATINALE_GEMINI_MODELE ?? 'gemini-3.6-flash-medium';
// Douze minutes : les quatre pages qui listent plus neuf recherches en coréen
// prennent six à dix minutes, et `agy` s'arrête lui-même à cinq par défaut,
// en rendant un tour à moitié fait, illisible. Le délai est donc passé au
// CLI, et le nôtre le dépasse d'une minute pour attraper le cas où il ne
// s'arrêterait pas. Au-delà, la session Claude a un horaire à tenir.
const DELAI_CLI = '12m';
const DELAI_MS = 13 * 60_000;

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const jour = option('--jour') ?? seoulToday();
const dossier = path.resolve(RACINE, option('--dossier') ?? 'veille');

const { domains } = JSON.parse(readFileSync(path.join(RACINE, 'config/sources.json'), 'utf8'));
const gabarit = readFileSync(path.join(RACINE, 'prompts/recherche-evenements.md'), 'utf8');

/** L'onglet tel qu'il est ; `[]` s'il est hors d'atteinte, et le journal le dit. */
async function connusDuSite({ timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SITE}/api/evenements.json`, { signal: controller.signal });
    if (!res.ok) return { connus: [], panne: `HTTP ${res.status}` };
    const { events } = await res.json();
    return { connus: Array.isArray(events) ? events : [], panne: null };
  } catch (e) {
    return { connus: [], panne: e.name === 'AbortError' ? `délai de ${timeoutMs} ms dépassé` : e.message };
  } finally {
    clearTimeout(minuteur);
  }
}

await mkdir(dossier, { recursive: true });
const sortie = path.join(dossier, `${jour}.md`);

// La veille est censée être là. Sinon, la section fait un fichier à elle
// seule, avec un titre : l'agent lit le même chemin dans les deux cas.
const veilleExiste = await access(sortie).then(() => true, () => false);
async function déposer(section) {
  if (veilleExiste) await appendFile(sortie, `\n${section}`);
  else await writeFile(sortie, `# Veille du ${jour} (heure de Séoul), flux non relevés\n\n${section}`);
}

const { connus, panne: panneSite } = await connusDuSite();
console.log(`${panneSite ? '!' : '✓'} ${'evenements.json'.padEnd(18)} ${panneSite ?? `${connus.length} événements connus`}`);

console.log(`modèle : ${MODELE}`);

// Les deux volets ensemble : chacun sa consigne, chacun sa session, chacun
// sa ligne de journal. Un volet en panne est un volet en moins, pas une
// matinée sans pistes ; les deux en panne, et c'est la panne d'avant, celle
// que la veille dit à l'agent et le code de sortie au lanceur.
const début = Date.now();
const résultats = await Promise.all(
  VOLETS.map(async (volet) => {
    const méthode = readFileSync(path.join(RACINE, volet.méthode), 'utf8');
    const consigne = composerConsigne(gabarit, { jour, connus, domaines: domains, méthode });
    const gemini = await interrogerGemini(consigne, { commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CLI, délaiMs: DELAI_MS, cwd: RACINE });
    return { volet: volet.nom, gemini, durée: Math.round((Date.now() - début) / 1000) };
  })
);

const étiquette = (nom) => `Gemini ${nom}`.padEnd(18);
const pistes = [];
const pannes = [];
for (const { volet, gemini, durée } of résultats) {
  if (gemini.panne) {
    console.log(`! ${étiquette(volet)} ${gemini.panne} (${durée} s)`);
    if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    pannes.push({ volet, panne: gemini.panne });
    continue;
  }
  let tableau;
  try {
    tableau = extraireTableau(gemini.réponse);
  } catch (e) {
    console.log(`! ${étiquette(volet)} ${e.message} (${durée} s)`);
    const trace = [gemini.réponse.slice(0, 2000), gemini.stderr ?? ''].join('\n').trim();
    if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
    pannes.push({ volet, panne: e.message });
    continue;
  }
  console.log(`✓ ${étiquette(volet)} ${tableau.length} pistes en ${durée} s${gemini.tours ? `, ${gemini.tours} tours` : ''}`);
  // Les refus de permission arrivent ici : un « read_url refusé » à chaque
  // ligne, et c'est le réglage du serveur qui manque, pas Gemini qui n'a rien
  // trouvé. Le journal doit pouvoir faire la différence.
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));
  pistes.push(...tableau);
}

// Les deux en panne : une seule raison si c'est la même, agy absent ou un
// réglage qui manque, sinon chacune avec son volet.
if (pannes.length === résultats.length) {
  const raisons = [...new Set(pannes.map(({ panne }) => panne))];
  await déposer(rendrePistes({ panne: raisons.length === 1 ? raisons[0] : pannes.map(({ volet, panne }) => `${volet} : ${panne}`).join(' ; ') }));
  process.exit(1);
}

const tri = await trierPistes(pistes, { domaines: domains, connus, today: jour });
for (const e of tri.retenues) console.log(`  ✓ ${e.name} · ${e.theme} · ${e.start_date} → ${e.end_date}`);
for (const { event, connu } of tri.prolongées) console.log(`  ↻ ${connu.name} : ${event.start_date} → ${event.end_date}`);
for (const { event, raison } of tri.écartées) console.log(`  ! ${event.name ?? '(sans nom)'} : ${raison}`);

await déposer(rendrePistes(tri));
console.log(
  `pistes écrites : ${path.relative(RACINE, sortie)} (${tri.retenues.length} retenues, ${tri.prolongées.length} prolongées, ${tri.écartées.length} écartées)`
);
