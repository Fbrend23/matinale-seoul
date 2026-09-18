#!/usr/bin/env node
// La veille actualité du matin : Gemini cherche dans la presse que les flux ne
// couvrent pas, le dépôt trie, la veille reçoit une section « Pistes
// actualité » que la session de rédaction lit.
//
//   node scripts/actualite.mjs                  # le jour courant à Séoul
//   node scripts/actualite.mjs --jour 2026-09-18
//
// Tourne APRÈS scripts/veille.mjs, dont il lit puis complète le fichier, et
// avant la session Claude ; en même temps que scripts/recherche.mjs, qui
// complète le même fichier (le lanceur les lance ensemble, et chacun n'écrit
// qu'une fois, à la fin : deux ajouts en fin de fichier ne se mêlent pas).
// Cinq sessions Gemini en parallèle, une par rubrique (VOLETS_ACTUALITE, dans
// lib/actualite.mjs, dit pourquoi cinq), par Antigravity CLI (`agy`) en
// headless, sur l'abonnement Google. Chacune répond un tableau JSON qu'elle
// ne dépose nulle part : c'est ce script qui écrit, après tri.
//
// Rien ici n'est bloquant pour la parution. Gemini absent, muet ou hors quota,
// la section le dit et l'agent compose avec les flux, comme avant. Le code de
// sortie dit si au moins un volet a répondu quelque chose de lisible : le
// lanceur le journalise, il ne s'arrête pas dessus.
//
//   MATINALE_GEMINI=/chemin/vers/un/faux      une autre commande, pour essayer sans quota
//   MATINALE_GEMINI_MODELE=…                 un autre modèle (`agy models` les liste)

import { readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { VOLETS_ACTUALITE, composerConsigneActualité, épurerPiste, lireVeille, trierPistesActualité, rendrePistesActualité } from './lib/actualite.mjs';
import { extraireTableau } from './lib/recherche.mjs';
import { interrogerGemini } from './lib/agy.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Le même modèle que la recherche, fixé et journalisé pour la même raison :
// une piste de moins un matin doit pouvoir se rattacher à sa cause. Un
// « medium » : chercher n'est pas juger, et le quota est commun.
const MODELE = process.env.MATINALE_GEMINI_MODELE ?? 'gemini-3.6-flash-medium';
// Douze minutes par volet, comme la recherche : une vingtaine d'appels, et
// `agy` s'arrête à cinq par défaut en rendant un tour à moitié fait. À dix,
// le 18 septembre 2026, les cinq volets en 3.6 ont été coupés au milieu de
// leur réponse. Le nôtre dépasse d'une minute, pour le cas où il ne
// s'arrêterait pas. Les cinq tournent ensemble : c'est le plus lent qui
// fait attendre la session.
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
const gabarit = readFileSync(path.join(RACINE, 'prompts/actualite-presse.md'), 'utf8');

await mkdir(dossier, { recursive: true });
const sortie = path.join(dossier, `${jour}.md`);

// La veille est censée être là : c'est contre elle que les pistes sont
// jugées neuves. Sans elle, tout est neuf, et la section fait un fichier à
// elle seule, avec un titre : l'agent lit le même chemin dans les deux cas.
const veilleExiste = await access(sortie).then(() => true, () => false);
const veille = lireVeille(veilleExiste ? await readFile(sortie, 'utf8') : '');
async function déposer(section) {
  if (veilleExiste) await appendFile(sortie, `\n${section}`);
  else await writeFile(sortie, `# Veille du ${jour} (heure de Séoul), flux non relevés\n\n${section}`);
}
console.log(`${veilleExiste ? '✓' : '!'} ${'veille'.padEnd(18)} ${veilleExiste ? `${veille.adresses.size} adresses déjà relevées, ${veille.publiés.length} titres publiés` : 'absente : rien à dédoublonner'}`);
console.log(`modèle : ${MODELE}`);

// Les cinq volets ensemble : chacun sa consigne, chacun sa session, chacun
// sa ligne de journal. Un volet en panne est une rubrique non cherchée, et
// la section le dit à l'agent ; les cinq en panne, c'est la panne d'avant.
const début = Date.now();
const résultats = await Promise.all(
  VOLETS_ACTUALITE.map(async (volet) => {
    const déjà = [...(veille.titres.get(volet.section) ?? []), ...veille.publiés];
    const consigne = composerConsigneActualité(gabarit, { jour, volet, domaines: domains, déjà });
    const gemini = await interrogerGemini(consigne, { commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CLI, délaiMs: DELAI_MS, cwd: RACINE });
    return { section: volet.section, gemini, durée: Math.round((Date.now() - début) / 1000) };
  })
);

const étiquette = (section) => `Gemini ${section}`.padEnd(18);
const pistes = [];
const pannes = [];
for (const { section, gemini, durée } of résultats) {
  if (gemini.panne) {
    console.log(`! ${étiquette(section)} ${gemini.panne} (${durée} s)`);
    if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    pannes.push({ section, panne: gemini.panne });
    continue;
  }
  let tableau;
  try {
    tableau = extraireTableau(gemini.réponse);
  } catch (e) {
    console.log(`! ${étiquette(section)} ${e.message} (${durée} s)`);
    const trace = [gemini.réponse.slice(0, 2000), gemini.stderr ?? ''].join('\n').trim();
    if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
    pannes.push({ section, panne: e.message });
    continue;
  }
  console.log(`✓ ${étiquette(section)} ${tableau.length} pistes en ${durée} s${gemini.tours ? `, ${gemini.tours} tours` : ''}`);
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));
  pistes.push(...tableau.map((p) => épurerPiste(p, section)));
}

if (pannes.length === résultats.length) {
  await déposer(rendrePistesActualité({ pannes }));
  process.exit(1);
}

const tri = await trierPistesActualité(pistes, { domaines: domains, veille });
for (const p of tri.retenues) console.log(`  ✓ ${p.section} · ${(p.headline ?? p.original_headline).slice(0, 70)} (${p.source_name ?? '?'})`);
for (const { piste, raison } of tri.écartées) console.log(`  ! ${piste.section} · ${(piste.headline ?? piste.original_headline ?? '(sans titre)').slice(0, 60)} : ${raison}`);

await déposer(rendrePistesActualité({ ...tri, pannes }));
console.log(`pistes actualité écrites : ${path.relative(RACINE, sortie)} (${tri.retenues.length} retenues, ${tri.écartées.length} écartées, ${pannes.length} rubrique(s) non cherchée(s))`);
