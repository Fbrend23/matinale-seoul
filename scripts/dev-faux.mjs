#!/usr/bin/env node
// Le site en dev, sans Directus.
//
//   npm run dev:faux
//   npm run dev:faux -- --port 4322
//
// Le même CMS de pacotille que le contrôle de rendu (scripts/lib/faux-cms.mjs),
// mais laissé ouvert, et le serveur de dev d'Astro branché dessus : de quoi
// regarder une page, retoucher une feuille de style, replier un menu sur un
// téléphone, sans jeton de lecture, et sans toucher au CMS. Les données sont
// celles de la fixture, posées autour d'aujourd'hui : un événement en cours,
// un qui finit bientôt, un à venir.
//
// Ce n'est PAS un aperçu du site : le contenu est faux. Pour voir le vrai,
// `npm run dev` avec un jeton de lecture dans .env.
//
// Le serveur est lancé par l'API d'Astro, dans ce processus, et non par
// `astro dev` en enfant. Depuis Astro 7.3, `astro dev` se détache tout seul en
// arrière-plan quand il se croit lancé par un agent (variable CLAUDECODE ou
// semblable dans l'environnement) : l'enfant rendait la main aussitôt, le
// script fermait le faux CMS, et le site répondait 500. En passant par l'API,
// rien ne se détache, et le faux CMS vit exactement aussi longtemps que lui.

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { donnéesDeDémonstration, démarrerLeFauxCms } from './lib/faux-cms.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const FIXTURE = path.join(RACINE, 'tests', 'fixtures', 'brief-avec-evenements.json');

const { values: options } = parseArgs({
  options: { port: { type: 'string' }, host: { type: 'boolean' } },
});

const faux = await démarrerLeFauxCms(await donnéesDeDémonstration(FIXTURE));
console.log(`Faux CMS sur ${faux.url}, Ctrl+C pour tout arrêter.\n`);

// `astro:env` lit process.env au chargement de la config : à poser AVANT
// d'importer Astro, qui charge tout au premier appel.
process.env.DIRECTUS_URL = faux.url;
process.env.DIRECTUS_TOKEN = 'faux';
process.env.SITE_URL = 'https://matinale.test';

const { dev } = await import('astro');
const serveur = await dev({
  root: RACINE,
  logLevel: 'info',
  server: {
    ...(options.port ? { port: Number(options.port) } : {}),
    ...(options.host ? { host: true } : {}),
  },
});

let arrêtEnCours = false;
const arrêter = async () => {
  if (arrêtEnCours) return;
  arrêtEnCours = true;
  await serveur.stop();
  await faux.fermer();
  process.exit(0);
};
process.on('SIGINT', arrêter);
process.on('SIGTERM', arrêter);
