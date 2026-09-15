#!/usr/bin/env node
// La recherche d'événements du matin : Gemini cherche, le dépôt trie, la veille
// reçoit une section « Pistes événements » que la session de rédaction lit.
//
//   node scripts/recherche.mjs                  # le jour courant à Séoul
//   node scripts/recherche.mjs --jour 2026-09-15
//
// Tourne APRÈS scripts/veille.mjs, dont il complète le fichier, et avant la
// session Claude. Gemini est interrogé par Antigravity CLI (`agy`), le
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

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { composerConsigne, extraireTableau, trierPistes, rendrePistes } from './lib/recherche.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const SITE = (process.env.SITE_URL ?? 'https://matinale.brendanfleurdelys.ch').replace(/\/$/, '');
const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
// Le modèle est FIXÉ ET JOURNALISÉ, pour la raison que bin/brief-du-jour.sh
// donne pour Claude : deux matins sur deux modèles différents sans que rien
// ne le dise, c'est une baisse de qualité impossible à rattacher à sa cause.
// Un Flash, parce que la recherche est bornée par le temps, pas par la
// finesse ; « high » pour le raisonnement, il faut trier des dates et des
// lieux. `agy models` liste ce qui existe.
const MODELE = process.env.MATINALE_GEMINI_MODELE ?? 'gemini-3.8-flash-high';
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

/**
 * Antigravity CLI, en headless, et sa réponse.
 *
 * AUCUN contournement des permissions. En headless, un outil que les réglages
 * n'autorisent pas est refusé en silence, la session continue, et le refus
 * part sur stderr, que ce script recopie au journal. Les lectures d'adresses
 * (`read_url(*)`) sont autorisées dans les réglages du serveur, voir
 * docs/parution-sur-serveur.md ; écriture, shell et MCP y sont refusés. Ne
 * jamais ajouter `--dangerously-skip-permissions` ici : ce serait donner à
 * une recherche les moyens d'écrire dans le dépôt.
 *
 * L'enveloppe JSON porte `status` (SUCCESS, ERROR, CANCELED…), `response` et
 * `error` ; c'est `status` qui dit si `response` vaut quelque chose.
 */
function interrogerGemini(consigne) {
  return new Promise((resolve) => {
    const argv = ['-p', consigne, '--output-format', 'json', '--print-timeout', DELAI_CLI];
    argv.push('--model', MODELE);
    let stdout = '';
    let stderr = '';
    let enfant;
    try {
      enfant = spawn(COMMANDE, argv, { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], timeout: DELAI_MS });
    } catch (e) {
      return resolve({ panne: e.message });
    }
    enfant.stdout.on('data', (d) => (stdout += d));
    enfant.stderr.on('data', (d) => (stderr += d));
    enfant.on('error', (e) => resolve({ panne: e.code === 'ENOENT' ? `commande introuvable : ${COMMANDE}` : e.message }));
    enfant.on('close', (code, signal) => {
      if (signal) return resolve({ panne: `interrompu (${signal}) après ${DELAI_MS / 60_000} minutes`, stderr });
      let sortie;
      try {
        sortie = JSON.parse(stdout);
      } catch {
        return resolve({ panne: `sortie illisible (code ${code})`, stderr, stdout });
      }
      if (sortie?.status && sortie.status !== 'SUCCESS') {
        const détail = typeof sortie.error === 'string' ? sortie.error : sortie.error?.message ?? '';
        return resolve({ panne: `Gemini : ${sortie.status}${détail ? `, ${détail}` : ''}`, stderr });
      }
      // Un outil refusé en headless ne fait pas échouer la session : elle
      // rend SUCCESS et une réponse vide, et c'est `denied_actions` qui le
      // dit. Sans cette ligne, le journal dirait « aucun tableau JSON », et
      // on chercherait du côté du prompt ce qui est un réglage du serveur.
      const refus = (sortie?.denied_actions ?? []).map((a) => a.action).filter(Boolean);
      if (refus.length) {
        return resolve({
          panne: `permission refusée : ${[...new Set(refus)].join(', ')}. Ajouter « read_url(*) » à permissions.allow dans ~/.gemini/antigravity-cli/settings.json, voir docs/parution-sur-serveur.md`,
          stderr,
        });
      }
      if (typeof sortie?.response !== 'string') return resolve({ panne: `pas de réponse (code ${code})`, stderr });
      return resolve({ réponse: sortie.response, stderr, tours: sortie.num_turns, durée: sortie.duration_seconds });
    });
  });
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
const consigne = composerConsigne(gabarit, { jour, connus, domaines: domains });
const début = Date.now();
const gemini = await interrogerGemini(consigne);
const durée = Math.round((Date.now() - début) / 1000);

if (gemini.panne) {
  console.log(`! ${'Gemini'.padEnd(18)} ${gemini.panne} (${durée} s)`);
  if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  await déposer(rendrePistes({ panne: gemini.panne }));
  process.exit(1);
}

let pistes;
try {
  pistes = extraireTableau(gemini.réponse);
} catch (e) {
  console.log(`! ${'Gemini'.padEnd(18)} ${e.message} (${durée} s)`);
  const trace = [gemini.réponse.slice(0, 2000), gemini.stderr ?? ''].join('\n').trim();
  if (trace) console.log(trace.split('\n').map((l) => `    ${l}`).join('\n'));
  await déposer(rendrePistes({ panne: e.message }));
  process.exit(1);
}

console.log(`✓ ${'Gemini'.padEnd(18)} ${pistes.length} pistes en ${durée} s${gemini.tours ? `, ${gemini.tours} tours` : ''}`);
// Les refus de permission arrivent ici : un « read_url refusé » à chaque
// ligne, et c'est le réglage du serveur qui manque, pas Gemini qui n'a rien
// trouvé. Le journal doit pouvoir faire la différence.
if (gemini.stderr?.trim()) console.log(gemini.stderr.trim().split('\n').slice(0, 20).map((l) => `    ${l}`).join('\n'));

const tri = await trierPistes(pistes, { domaines: domains, connus, today: jour });
for (const e of tri.retenues) console.log(`  ✓ ${e.name} · ${e.theme} · ${e.start_date} → ${e.end_date}`);
for (const { event, connu } of tri.prolongées) console.log(`  ↻ ${connu.name} : ${event.start_date} → ${event.end_date}`);
for (const { event, raison } of tri.écartées) console.log(`  ! ${event.name ?? '(sans nom)'} : ${raison}`);

await déposer(rendrePistes(tri));
console.log(
  `pistes écrites : ${path.relative(RACINE, sortie)} (${tri.retenues.length} retenues, ${tri.prolongées.length} prolongées, ${tri.écartées.length} écartées)`
);
