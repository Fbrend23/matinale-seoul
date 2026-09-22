#!/usr/bin/env node
// La relecture du brief du jour : Gemini relit contre les sources, par lots,
// le dépôt vérifie, le contrôle juge, et le fichier d'inbox/ est remplacé par
// le brief relu seulement si tout passe.
//
//   node scripts/relecture.mjs                  # inbox/brief-<jour à Séoul>.json
//   node scripts/relecture.mjs --jour 2026-09-18
//
// Tourne APRÈS la session Claude, qui a déposé et contrôlé son brief sans le
// commiter, et AVANT le commit, que le lanceur fait ensuite. Un lot par
// rubrique pourvue, un pour les événements, en parallèle, chacun sa session
// Antigravity CLI (`agy`) en headless, sur l'abonnement Google, avec le lot
// dans la consigne et le seul droit d'ouvrir des pages
// (docs/parution-sur-serveur.md). lib/relecture.mjs dit pourquoi une
// relecture, pourquoi par lots, et ce qu'elle n'a pas le droit de faire.
//
// LE BRIEF DE LA SESSION EST L'ÉTAT SÛR. Tout ce qui ne passe pas, Gemini
// muet, relecture qui ajoute ou change une adresse, brief relu que le
// contrôle recale, laisse inbox/ tel quel : le lanceur commite alors le
// brief de la session, qui a déjà passé le contrôle. Un lot en panne est un
// lot non relu, les autres comptent. Le rapport dans veille/relecture/ dit
// ce qui s'est passé, dans tous les cas.
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

import {
  lotsDe, composerConsigneRelecture, extraireRelecture, recomposer,
  rétablirAdresses, rétablirHeures, vérifierRelecture, écarts, rendreRapport,
} from './lib/relecture.mjs';
import { décrireSession, interrogerGemini, totalSessions } from './lib/agy.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Fixé et journalisé, comme les autres modèles du matin. Le 3.8 en « high »
// ici, quand la recherche et l'actualité se contentent du « medium » :
// relire, c'est confronter un résumé à une page et y voir une joueuse
// inventée d'après le nom d'une salle, et c'est là que la finesse paie. Le
// 21 septembre 2026, la relecture d'un bloc était descendue en « medium » :
// la session la plus lourde de la matinée, un million à un million et demi
// de tokens lus, et le quota hebdomadaire ne tenait pas. Par lots, chaque
// session n'ouvre que trois ou quatre pages, et le « high » redevient
// abordable ; le journal des tokens dira si le quota tient.
const MODELE = process.env.MATINALE_RELECTURE_MODELE ?? 'gemini-3.8-flash-high';
// Huit minutes par lot : trois ou quatre pages, une dizaine pour les
// événements, et la réécriture ; `agy` s'arrête à cinq par défaut en rendant
// un tour à moitié fait. Le nôtre dépasse d'une minute. Les lots tournent
// ensemble : c'est le plus lent qui fait attendre le commit.
const DELAI_CLI = '8m';
const DELAI_MS = 9 * 60_000;

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

// --- Les lots, ensemble ---------------------------------------------------------
const lots = lotsDe(original);
const début = Date.now();
const résultats = await Promise.all(
  lots.map(async (lot) => {
    const consigne = composerConsigneRelecture(gabarit, { jour, lot });
    const gemini = await interrogerGemini(consigne, { commande: COMMANDE, modèle: MODELE, délaiCli: DELAI_CLI, délaiMs: DELAI_MS, cwd: RACINE });
    return { lot, gemini, durée: Math.round((Date.now() - début) / 1000) };
  })
);

const relus = new Map();
const corrections = [];
const pannes = [];
let tours = 0;
const usage = { input_tokens: 0, output_tokens: 0 };
for (const { lot, gemini, durée } of résultats) {
  if (gemini.panne) {
    console.log(`! ${étiquette(`Gemini ${lot.nom}`)} ${gemini.panne} (${durée} s)`);
    if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    pannes.push(`${lot.nom} : ${gemini.panne}`);
    continue;
  }
  let relecture;
  try {
    relecture = extraireRelecture(gemini.réponse);
  } catch (e) {
    console.log(`! ${étiquette(`Gemini ${lot.nom}`)} ${e.message} (${durée} s)`);
    const trace = [gemini.réponse.slice(0, 1500), gemini.stderr ?? ''].join('\n').trim();
    if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
    // La réponse entière à côté du rapport : quinze cents caractères de
    // journal ne disent pas où la forme a dévié, et c'est ce qu'on veut relire.
    const fichierRéponse = path.join(dossier, `reponse-${jour}-${lot.nom}.txt`);
    await writeFile(fichierRéponse, gemini.réponse);
    console.log(`réponse       : ${path.relative(RACINE, fichierRéponse)}`);
    pannes.push(`${lot.nom} : ${e.message}`);
    continue;
  }
  console.log(`✓ ${étiquette(`Gemini ${lot.nom}`)} relu en ${durée} s${décrireSession(gemini)}, ${relecture.corrections.length} correction(s) annoncée(s)`);
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));
  relus.set(lot.nom, relecture.lot);
  corrections.push(...relecture.corrections);
  tours += gemini.tours ?? 0;
  usage.input_tokens += gemini.usage?.input_tokens ?? 0;
  usage.output_tokens += gemini.usage?.output_tokens ?? 0;
}
const session = { modèle: MODELE, durée: Math.round((Date.now() - début) / 1000), tours, usage, lots: lots.length, pannes };
const total = totalSessions(résultats.map((r) => r.gemini));
if (total) console.log(`✓ ${étiquette('total')} ${total}`);

if (!relus.size) {
  console.log(`! ${étiquette('relecture')} aucun lot relu : le brief de la session part tel quel`);
  await conclure({ sort: 'panne', raison: pannes.join(' ; '), session, code: 1 });
}

// --- A-t-il seulement relu ? ----------------------------------------------------
// Le brief recomposé est déposé dans veille/relecture/ AVANT d'être jugé :
// une relecture refusée se relit aussi, c'est même celle qu'on veut relire.
const relu = recomposer(original, relus);
rétablirAdresses(original, relu);
rétablirHeures(original, relu);
await writeFile(fichierRelu, `${JSON.stringify(relu, null, 2)}\n`);
const raisons = vérifierRelecture(original, { corrections, brief: relu });
const liste = écarts(original, relu);
if (raisons.length) {
  console.log(`! ${étiquette('relecture')} refusée, le brief de la session part tel quel :`);
  for (const r of raisons) console.log(`    · ${r}`);
  await conclure({ sort: 'refusée', raison: raisons.join(' ; '), corrections, liste, session, code: 1 });
}
for (const e of liste) console.log(`  · ${e.cible} · ${e.champ}`);
for (const c of corrections) console.log(`    ${c.cible ?? '?'} · ${c.champ ?? '?'} : ${c.pourquoi ?? ''}`);

if (!liste.length) {
  console.log(`✓ ${étiquette('relecture')} rien à changer${pannes.length ? ` (${pannes.length} lot(s) non relu(s))` : ''}`);
  await conclure({ sort: 'sans changement', corrections, liste, session, code: pannes.length ? 1 : 0 });
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
  await conclure({ sort: 'recalée', raison: 'le contrôle avant vol recale le brief relu', corrections, liste, session, verdict: verdict.rapport, code: 1 });
}

await writeFile(fichier, `${JSON.stringify(relu, null, 2)}\n`);
console.log(`✓ ${étiquette('relecture')} appliquée : ${path.relative(RACINE, fichier)} (${liste.length} changement(s)${pannes.length ? `, ${pannes.length} lot(s) non relu(s)` : ''})`);
await conclure({ sort: 'appliquée', corrections, liste, session, verdict: verdict.rapport, code: 0 });
