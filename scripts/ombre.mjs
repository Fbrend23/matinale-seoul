#!/usr/bin/env node
// Le brief en ombre : Gemini rédige, le contrôle juge, rien n'est publié.
//
//   node scripts/ombre.mjs                  # le jour courant à Séoul
//   node scripts/ombre.mjs --jour 2026-09-16
//
// Tourne APRÈS la session Claude, sur la même veille, et dépose dans
// veille/ombre/ : brief-AAAA-MM-JJ.json, le brief de Gemini tel que le
// contrôle avant vol l'a laissé, et ombre-AAAA-MM-JJ.md, la comparaison
// avec le brief de la session, celui d'inbox/ ou de l'archive. Gemini est
// interrogé par Antigravity CLI (`agy`), en headless, sur l'abonnement
// Google, avec le droit de lire veille/ et d'ouvrir des pages, rien d'autre
// (docs/parution-sur-serveur.md). lib/ombre.mjs dit pourquoi une ombre.
//
// Rien ici n'est bloquant pour la parution : le lanceur journalise le code
// de sortie, il ne s'arrête pas dessus. Sans veille, l'ombre n'a rien à
// lire et le dit.
//
//   MATINALE_GEMINI=/chemin/vers/un/faux      une autre commande, pour essayer sans quota
//   MATINALE_OMBRE_MODELE=…                  un autre modèle (`agy models` les liste)
//   MATINALE_OMBRE_CORRECTIONS=1             tours de correction après un contrôle recalé (défaut 1)

import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

import { exempleDuPrompt, composerConsigneOmbre, consigneDeCorrection, extraireObjet, comparer } from './lib/ombre.mjs';
import { interrogerGemini } from './lib/agy.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Fixé et journalisé, comme les deux autres modèles du matin. Le même Flash
// que la recherche pour commencer : c'est lui qu'on compare à la session,
// et le jour où il ne suffit pas, `agy models` en liste d'autres.
const MODELE = process.env.MATINALE_OMBRE_MODELE ?? 'gemini-3.6-flash-high';
const CORRECTIONS = Number(process.env.MATINALE_OMBRE_CORRECTIONS ?? 1);
// Vingt minutes : une trentaine de pages à ouvrir et quatorze résumés à
// écrire, la session Claude y met neuf minutes. Le tour de correction, lui,
// n'ouvre rien : cinq minutes.
const DELAI_CLI = '20m';
const DELAI_MS = 21 * 60_000;
const DELAI_CORRECTION_CLI = '5m';
const DELAI_CORRECTION_MS = 6 * 60_000;

const exécuter = promisify(execFile);

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const jour = option('--jour') ?? seoulToday();
const dossierVeille = path.resolve(RACINE, option('--veille') ?? 'veille');
const dossier = path.resolve(RACINE, option('--dossier') ?? 'veille/ombre');

const veille = path.join(dossierVeille, `${jour}.md`);
if (!existsSync(veille)) {
  console.log(`! ${'ombre'.padEnd(18)} pas de veille pour le ${jour} (${path.relative(RACINE, veille)}) : rien à lire`);
  process.exit(1);
}

const { domains } = JSON.parse(readFileSync(path.join(RACINE, 'config/sources.json'), 'utf8'));
const gabarit = readFileSync(path.join(RACINE, 'prompts/brief-ombre.md'), 'utf8');
const exemple = exempleDuPrompt(readFileSync(path.join(RACINE, 'prompts/brief-quotidien.md'), 'utf8'));

await mkdir(dossier, { recursive: true });
const fichierBrief = path.join(dossier, `brief-${jour}.json`);
const fichierComparaison = path.join(dossier, `ombre-${jour}.md`);

console.log(`modèle ombre : ${MODELE}`);

// --- La rédaction ---------------------------------------------------------------
const consigne = composerConsigneOmbre(gabarit, { jour, veille: path.relative(RACINE, veille), domaines: domains, exemple });
const début = Date.now();
const gemini = await interrogerGemini(consigne, { commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CLI, délaiMs: DELAI_MS, cwd: RACINE });
const durée = Math.round((Date.now() - début) / 1000);

if (gemini.panne) {
  console.log(`! ${'Gemini ombre'.padEnd(18)} ${gemini.panne} (${durée} s)`);
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  process.exit(1);
}

let brief;
try {
  brief = extraireObjet(gemini.réponse);
} catch (e) {
  console.log(`! ${'Gemini ombre'.padEnd(18)} ${e.message} (${durée} s)`);
  const trace = [gemini.réponse.slice(0, 2000), gemini.stderr ?? ''].join('\n').trim();
  if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${'Gemini ombre'.padEnd(18)} brief rendu en ${durée} s${gemini.tours ? `, ${gemini.tours} tours` : ''}`);
if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));

// --- Le contrôle avant vol, et les corrections -----------------------------------
// Le même contrôle que la session, sur le même fichier nommé de la même
// façon : le nom porte la date, et le contrôle la compare au contenu.
async function contrôler() {
  await writeFile(fichierBrief, `${JSON.stringify(brief, null, 2)}\n`);
  try {
    const { stdout } = await exécuter('node', ['scripts/preflight.mjs', fichierBrief], { cwd: RACINE, env: process.env });
    return { passe: true, rapport: stdout };
  } catch (e) {
    return { passe: false, rapport: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

let verdict = await contrôler();
let passages = 1;
console.log(`${verdict.passe ? '✓' : '!'} ${'contrôle'.padEnd(18)} ${verdict.passe ? 'passe' : 'recalé'} au premier passage`);

for (let n = 1; !verdict.passe && n <= CORRECTIONS; n += 1) {
  const correction = await interrogerGemini(consigneDeCorrection(jour, brief, verdict.rapport), {
    commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CORRECTION_CLI, délaiMs: DELAI_CORRECTION_MS, cwd: RACINE,
  });
  if (correction.panne) {
    console.log(`! ${'correction'.padEnd(18)} ${correction.panne}`);
    break;
  }
  try {
    brief = extraireObjet(correction.réponse);
  } catch (e) {
    console.log(`! ${'correction'.padEnd(18)} ${e.message}`);
    break;
  }
  verdict = await contrôler();
  passages += 1;
  console.log(`${verdict.passe ? '✓' : '!'} ${'contrôle'.padEnd(18)} ${verdict.passe ? 'passe' : 'toujours recalé'} après correction ${n}`);
}
console.log(verdict.rapport.trim().split('\n').map((l) => `    ${l}`).join('\n'));

// --- La comparaison --------------------------------------------------------------
// Le brief de la session : dans inbox/ tant que la publication ne l'a pas
// déplacé, dans archive/ ensuite. L'ombre tourne juste après la session,
// donc inbox/ d'abord ; relancée à la main un autre jour, l'archive.
const candidats = [path.join(RACINE, 'inbox', `brief-${jour}.json`), path.join(RACINE, 'archive', jour.slice(0, 4), `brief-${jour}.json`)];
const fichierRéférence = candidats.find((f) => existsSync(f));
const référence = fichierRéférence ? JSON.parse(await readFile(fichierRéférence, 'utf8')) : null;

const comparaison = comparer({
  jour,
  ombre: brief,
  référence,
  verdict: { passe: verdict.passe, tours: passages },
  session: { modèle: MODELE, durée, tours: gemini.tours, usage: gemini.usage },
  fichiers: { ombre: path.relative(RACINE, fichierBrief), référence: fichierRéférence ? path.relative(RACINE, fichierRéférence) : undefined },
});
await writeFile(fichierComparaison, `${comparaison}\n`);

const compte = (b) => (b?.sections ?? []).map((s) => `${s.key} ${s.items?.length ?? 0}`).join(', ');
console.log(`ombre écrite : ${path.relative(RACINE, fichierBrief)} (${compte(brief)} ; ${brief.events?.length ?? 0} événements)`);
if (référence) console.log(`session       : ${path.relative(RACINE, fichierRéférence)} (${compte(référence)} ; ${référence.events?.length ?? 0} événements)`);
else console.log('session       : pas de brief ce matin, comparaison sans référence');
console.log(`comparaison   : ${path.relative(RACINE, fichierComparaison)}`);
process.exit(verdict.passe ? 0 : 1);
