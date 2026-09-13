#!/usr/bin/env node
// Le site en dev, sans Directus.
//
//   npm run dev:faux
//
// Le même CMS de pacotille que le contrôle de rendu (scripts/lib/faux-cms.mjs),
// mais laissé ouvert, et `astro dev` branché dessus : de quoi regarder une
// page, retoucher une feuille de style, replier un menu sur un téléphone — sans
// jeton de lecture, et sans toucher au CMS. Les données sont celles de la
// fixture, posées autour d'aujourd'hui : un événement en cours, un qui finit
// bientôt, un à venir.
//
// Ce n'est PAS un aperçu du site : le contenu est faux. Pour voir le vrai,
// `npm run dev` avec un jeton de lecture dans .env.

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { donnéesDeDémonstration, démarrerLeFauxCms } from './lib/faux-cms.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const FIXTURE = path.join(RACINE, 'tests', 'fixtures', 'brief-avec-evenements.json');

const faux = await démarrerLeFauxCms(await donnéesDeDémonstration(FIXTURE));
console.log(`Faux CMS sur ${faux.url} — Ctrl+C pour tout arrêter.\n`);

// Le binaire d'Astro par node directement, comme dans rendu.mjs : pas de
// shell, donc rien à échapper. Les arguments après `--` passent à astro dev
// (`npm run dev:faux -- --port 4322`).
const astro = path.join(RACINE, 'node_modules', 'astro', 'bin', 'astro.mjs');
const enfant = spawn(process.execPath, [astro, 'dev', ...process.argv.slice(2)], {
  cwd: RACINE,
  env: { ...process.env, DIRECTUS_URL: faux.url, DIRECTUS_TOKEN: 'faux', SITE_URL: 'https://matinale.test' },
  stdio: 'inherit',
});

const arrêter = async () => {
  enfant.kill();
  await faux.fermer();
  process.exit(0);
};
process.on('SIGINT', arrêter);
process.on('SIGTERM', arrêter);
enfant.on('close', async (code) => {
  await faux.fermer();
  process.exit(code ?? 0);
});
