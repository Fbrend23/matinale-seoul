#!/usr/bin/env node
// Le quota Gemini, tel qu'`agy /usage` le donne, sur une ligne pour le journal.
//
//   node scripts/quota.mjs            # « quota Gemini : 5 h 85 % (reset 10:30), semaine 75 % (reset me. 23) »
//   node scripts/quota.mjs --json     # la réponse brute d'agy
//
// Lancé par bin/brief-du-jour.sh avant la première session Gemini et après
// la dernière : la différence entre les deux lignes est ce que la matinée a
// coûté, et c'est la seule mesure qui vaille. Le quota se consomme « en
// proportion du coût des tokens », dit Google, sans autre chiffre : un
// modèle moins cher ou une session plus courte puise moins, et de combien,
// seul ce relevé le dit. Ne coûte rien : zéro token, zéro tour.
//
// Rien ici n'est bloquant : agy absent ou muet, une ligne le dit, et la
// matinée continue. Le code de sortie est toujours 0.
//
//   MATINALE_GEMINI=/chemin/vers/un/faux      une autre commande, pour essayer sans agy

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const COMMANDE = process.env.MATINALE_GEMINI ?? 'agy';
const exécuter = promisify(execFile);

/** L'heure d'un reset, courte, à l'heure de la machine : c'est là qu'on lit le journal. */
function quand(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  const dansLaJournée = Date.now() + 24 * 3_600_000 > d.getTime();
  return dansLaJournée
    ? d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric' });
}

/**
 * Une ligne par groupe de modèles, le seau de 5 h puis la semaine.
 *
 * @param {object} sortie     la réponse JSON d'agy
 * @returns {string[]}
 */
export function lignesDeQuota(sortie) {
  const groupes = sortie?.command?.data?.groups ?? [];
  return groupes.map((g) => {
    const seaux = (g.buckets ?? []).map((b) => {
      const nom = b.window === '5h' ? '5 h' : b.window === 'weekly' ? 'semaine' : b.window ?? '?';
      const pct = typeof b.remaining_fraction === 'number' ? `${Math.round(b.remaining_fraction * 100)} %` : '?';
      return `${nom} ${pct} (reset ${quand(b.reset_time)})`;
    });
    const groupe = /gemini/i.test(g.name) ? 'Gemini' : g.name;
    return `quota ${groupe} : ${seaux.join(', ')}`;
  });
}

// pathToFileURL, et non une concaténation : le dépôt vit dans un dossier avec
// une espace, « Seoul News », que l'URL encode en %20.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let sortie;
  try {
    const { stdout } = await exécuter(COMMANDE, ['-p', '/usage', '--output-format', 'json'], { timeout: 60_000 });
    sortie = JSON.parse(stdout);
  } catch (e) {
    console.log(`quota Gemini : inconnu (${e.code === 'ENOENT' ? `commande introuvable : ${COMMANDE}` : e.message.split('\n')[0]})`);
    process.exit(0);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(sortie, null, 2));
  } else {
    const lignes = lignesDeQuota(sortie);
    // Seul Gemini compte ici : Claude passe par son propre abonnement, pas
    // par agy. La ligne des autres modèles n'est là que si Gemini manque.
    const gemini = lignes.filter((l) => l.startsWith('quota Gemini'));
    for (const l of gemini.length ? gemini : lignes) console.log(l);
    if (!lignes.length) console.log('quota Gemini : inconnu (réponse sans groupes)');
  }
}
