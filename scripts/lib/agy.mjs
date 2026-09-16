// Antigravity CLI (`agy`), en headless, pour les scripts qui font travailler
// Gemini avant ou à côté de la session qui rédige : la recherche d'événements
// (scripts/recherche.mjs) et le brief en ombre (scripts/ombre.mjs).
//
// AUCUN contournement des permissions. En headless, un outil que les réglages
// n'autorisent pas est refusé en silence, la session continue, et le refus
// part sur stderr, que le script appelant recopie au journal. Ce que le
// serveur autorise, lecture d'adresses et lecture de veille/, est dans
// docs/parution-sur-serveur.md ; écriture, shell et MCP y sont refusés. Ne
// jamais ajouter `--dangerously-skip-permissions` ici : ce serait donner à
// une session Gemini les moyens d'écrire dans le dépôt.
//
// L'enveloppe JSON porte `status` (SUCCESS, ERROR, CANCELED…), `response` et
// `error` ; c'est `status` qui dit si `response` vaut quelque chose.

import { spawn } from 'node:child_process';

/**
 * Une session `agy -p`, et ce qu'elle a répondu.
 *
 * @param {string} consigne
 * @param {object} p
 * @param {string} p.commande       `agy`, ou un faux pour les essais
 * @param {string} p.modèle         `agy models` les liste
 * @param {string} p.délaiCli       passé au CLI (`12m`), qui s'arrête à 5 min par défaut
 * @param {number} p.délaiMs        le nôtre, un peu au-dessus, pour le cas où il ne s'arrêterait pas
 * @param {string} p.cwd
 * @returns {Promise<{réponse?: string, tours?: number, durée?: number, usage?: object, panne?: string, stderr?: string, stdout?: string}>}
 */
export function interrogerGemini(consigne, { commande, modèle, délaiCli, délaiMs, cwd }) {
  return new Promise((resolve) => {
    const argv = ['-p', consigne, '--output-format', 'json', '--print-timeout', délaiCli, '--model', modèle];
    let stdout = '';
    let stderr = '';
    let enfant;
    try {
      enfant = spawn(commande, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: délaiMs });
    } catch (e) {
      return resolve({ panne: e.message });
    }
    enfant.stdout.on('data', (d) => (stdout += d));
    enfant.stderr.on('data', (d) => (stderr += d));
    enfant.on('error', (e) => resolve({ panne: e.code === 'ENOENT' ? `commande introuvable : ${commande}` : e.message }));
    enfant.on('close', (code, signal) => {
      if (signal) return resolve({ panne: `interrompu (${signal}) après ${délaiMs / 60_000} minutes`, stderr });
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
          panne: `permission refusée : ${[...new Set(refus)].join(', ')}. Compléter permissions.allow dans ~/.gemini/antigravity-cli/settings.json, voir docs/parution-sur-serveur.md`,
          stderr,
        });
      }
      if (typeof sortie?.response !== 'string') return resolve({ panne: `pas de réponse (code ${code})`, stderr });
      return resolve({ réponse: sortie.response, stderr, tours: sortie.num_turns, durée: sortie.duration_seconds, usage: sortie.usage });
    });
  });
}
