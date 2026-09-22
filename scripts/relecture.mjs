#!/usr/bin/env node
// La relecture du brief du jour : Gemini relit contre les sources, le dépôt
// vérifie, le contrôle juge, et le fichier d'inbox/ est remplacé par le brief
// relu seulement si tout passe.
//
//   node scripts/relecture.mjs                  # inbox/brief-<jour à Séoul>.json
//   node scripts/relecture.mjs --jour 2026-09-18
//
// Tourne APRÈS la session Claude, qui a déposé et contrôlé son brief sans le
// commiter, et AVANT le commit, que le lanceur fait ensuite. Gemini est
// interrogé par Antigravity CLI (`agy`), en headless, sur l'abonnement
// Google, avec le brief dans la consigne et le seul droit d'ouvrir des pages
// (docs/parution-sur-serveur.md). lib/relecture.mjs dit pourquoi une
// relecture, et ce qu'elle n'a pas le droit de faire.
//
// LE BRIEF DE LA SESSION EST L'ÉTAT SÛR. Tout ce qui ne passe pas, Gemini
// muet, relecture qui ajoute ou change une adresse, brief relu que le
// contrôle recale, laisse inbox/ tel quel : le lanceur commite alors le
// brief de la session, qui a déjà passé le contrôle. Le rapport dans
// veille/relecture/ dit ce qui s'est passé, dans tous les cas.
//
// Code de sortie : 0 si la relecture a été appliquée ou n'a rien trouvé à
// changer, 1 sinon. Le lanceur le journalise, il ne s'arrête pas dessus.
//
//   MATINALE_GEMINI=/chemin/vers/un/faux      une autre commande, pour essayer sans quota
//   MATINALE_RELECTURE_MODELE=…              un autre modèle (`agy models` les liste)

import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

import { composerConsigneRelecture, extraireRelecture, rétablirAdresses, rétablirHeures, vérifierRelecture, écarts, rendreRapport } from './lib/relecture.mjs';
import { interrogerGemini } from './lib/agy.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Fixé et journalisé, comme les autres modèles du matin. « medium » depuis
// le 21 septembre 2026 : c'est la session la plus lourde de la matinée, un
// million à un million et demi de tokens lus (chaque page rouverte reste
// dans le contexte), et le quota hebdomadaire ne tenait pas en « high ».
const MODELE = process.env.MATINALE_RELECTURE_MODELE ?? 'gemini-3.8-flash-medium';
// Quinze minutes : une page par item et par événement, une trentaine, plus
// la réécriture ; l'ombre, qui en ouvre autant, y met sept minutes. Le nôtre
// dépasse d'une minute, pour le cas où `agy` ne s'arrêterait pas.
const DELAI_CLI = '15m';
const DELAI_MS = 16 * 60_000;

const exécuter = promisify(execFile);

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const jour = option('--jour') ?? seoulToday();
const fichier = path.resolve(RACINE, option('--fichier') ?? path.join('inbox', `brief-${jour}.json`));
const dossier = path.resolve(RACINE, option('--dossier') ?? 'veille/relecture');

const étiquette = (nom) => nom.padEnd(18);

if (!existsSync(fichier)) {
  console.log(`! ${étiquette('relecture')} pas de brief à relire (${path.relative(RACINE, fichier)})`);
  process.exit(1);
}

const gabarit = readFileSync(path.join(RACINE, 'prompts/relecture.md'), 'utf8');
const original = JSON.parse(await readFile(fichier, 'utf8'));

await mkdir(dossier, { recursive: true });
const fichierRelu = path.join(dossier, path.basename(fichier));
const fichierRapport = path.join(dossier, `relecture-${jour}.md`);

console.log(`modèle relecture : ${MODELE}`);

async function conclure({ sort, raison, corrections = [], liste = [], session, verdict, code }) {
  await writeFile(fichierRapport, `${rendreRapport({ jour, sort, raison, corrections, écarts: liste, session, verdict })}\n`);
  console.log(`rapport       : ${path.relative(RACINE, fichierRapport)}`);
  process.exit(code);
}

// --- La relecture ---------------------------------------------------------------
const consigne = composerConsigneRelecture(gabarit, { jour, brief: original });
const début = Date.now();
const gemini = await interrogerGemini(consigne, { commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CLI, délaiMs: DELAI_MS, cwd: RACINE });
const durée = Math.round((Date.now() - début) / 1000);
const session = { modèle: MODELE, durée, tours: gemini.tours, usage: gemini.usage };

if (gemini.panne) {
  console.log(`! ${étiquette('Gemini relecture')} ${gemini.panne} (${durée} s)`);
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  await conclure({ sort: 'panne', raison: gemini.panne, session, code: 1 });
}

let relecture;
try {
  relecture = extraireRelecture(gemini.réponse);
} catch (e) {
  console.log(`! ${étiquette('Gemini relecture')} ${e.message} (${durée} s)`);
  const trace = [gemini.réponse.slice(0, 2000), gemini.stderr ?? ''].join('\n').trim();
  if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
  // La réponse entière à côté du rapport : deux mille caractères de journal
  // ne disent pas où la forme a dévié, et c'est ce qu'on veut relire.
  const fichierRéponse = path.join(dossier, `reponse-${jour}.txt`);
  await writeFile(fichierRéponse, gemini.réponse);
  console.log(`réponse       : ${path.relative(RACINE, fichierRéponse)}`);
  await conclure({ sort: 'panne', raison: e.message, session, code: 1 });
}
console.log(`✓ ${étiquette('Gemini relecture')} brief relu en ${durée} s${gemini.tours ? `, ${gemini.tours} tours` : ''}, ${relecture.corrections.length} correction(s) annoncée(s)`);
if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));

// --- A-t-il seulement relu ? ----------------------------------------------------
// Le brief rendu est déposé dans veille/relecture/ AVANT d'être jugé : une
// relecture refusée se relit aussi, c'est même celle qu'on veut relire.
rétablirAdresses(original, relecture.brief);
rétablirHeures(original, relecture.brief);
await writeFile(fichierRelu, `${JSON.stringify(relecture.brief, null, 2)}\n`);
const raisons = vérifierRelecture(original, relecture);
const liste = écarts(original, relecture.brief);
if (raisons.length) {
  console.log(`! ${étiquette('relecture')} refusée, le brief de la session part tel quel :`);
  for (const r of raisons) console.log(`    · ${r}`);
  await conclure({ sort: 'refusée', raison: raisons.join(' ; '), corrections: relecture.corrections, liste, session, code: 1 });
}
for (const e of liste) console.log(`  · ${e.cible} · ${e.champ}`);
for (const c of relecture.corrections) console.log(`    ${c.cible ?? '?'} · ${c.champ ?? '?'} : ${c.pourquoi ?? ''}`);

if (!liste.length) {
  console.log(`✓ ${étiquette('relecture')} rien à changer`);
  await conclure({ sort: 'sans changement', corrections: relecture.corrections, liste, session, code: 0 });
}

// --- Le contrôle avant vol, sur le brief relu ------------------------------------
// Le même contrôle que la session, sur un fichier du même nom : le nom porte
// la date, et le contrôle la compare au contenu. Dans veille/relecture/, pas
// dans inbox/ : tant qu'il n'a pas passé, il n'est pas le brief du jour.
let verdict;
try {
  const { stdout } = await exécuter('node', ['scripts/preflight.mjs', fichierRelu], { cwd: RACINE, env: process.env });
  verdict = { passe: true, rapport: stdout };
} catch (e) {
  verdict = { passe: false, rapport: `${e.stdout ?? ''}${e.stderr ?? ''}` };
}
console.log(verdict.rapport.trim().split('\n').map((l) => `    ${l}`).join('\n'));

if (!verdict.passe) {
  console.log(`! ${étiquette('relecture')} le brief relu serait recalé : le brief de la session part tel quel`);
  await conclure({ sort: 'recalée', raison: 'le contrôle avant vol recale le brief relu', corrections: relecture.corrections, liste, session, verdict: verdict.rapport, code: 1 });
}

await writeFile(fichier, `${JSON.stringify(relecture.brief, null, 2)}\n`);
console.log(`✓ ${étiquette('relecture')} appliquée : ${path.relative(RACINE, fichier)} (${liste.length} changement(s))`);
await conclure({ sort: 'appliquée', corrections: relecture.corrections, liste, session, verdict: verdict.rapport, code: 0 });
