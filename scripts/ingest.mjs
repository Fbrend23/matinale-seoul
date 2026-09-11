#!/usr/bin/env node
// Ingestion des briefs déposés dans inbox/.
//
//   node scripts/ingest.mjs inbox/brief-2026-09-04.json
//   node scripts/ingest.mjs                 # tous les brief-*.json de inbox/
//
// Ce fichier ne décide de rien : il lit l'inbox, le schéma et l'allowlist,
// construit le client CMS, et pose le code de sortie. Les cinq gardes et leur
// ordre vivent dans lib/ingestion.mjs, où ils se testent.
//
// Codes de sortie :
//   0  brief publié, ou déjà publié (rien à faire), ou inbox vide
//   1  brief recalé — le workflow échoue, GitHub envoie le mail, et le fichier
//      reste dans inbox/ pour être rejoué une fois la cause comprise

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { seoulDate } from './lib/guards.mjs';
import { createClient } from './lib/directus.mjs';
import { ingérer, tracerLÉchec } from './lib/ingestion.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const INBOX = path.join(RACINE, 'inbox');

const dire = (ligne) => console.log(ligne);

/** Fichiers à traiter : celui qu'on nous donne, ou tout ce que l'inbox contient. */
async function àTraiter() {
  const donné = process.argv[2];
  if (donné) return [path.resolve(donné)];

  const entrées = await readdir(INBOX).catch(() => []);
  return entrées
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(INBOX, f));
}

const lireJSON = async (...bouts) => JSON.parse(await readFile(path.join(RACINE, ...bouts), 'utf8'));

// --- Programme ---------------------------------------------------------------

const fichiers = await àTraiter();

if (!fichiers.length) {
  // L'inbox vide est le cas NORMAL : la chaîne ne tourne qu'une fois par jour.
  console.log('inbox vide, rien à ingérer.');
  process.exit(0);
}

// Lus une fois pour tout le run : ils ne changent pas d'un brief à l'autre.
const schéma = await lireJSON('schemas', 'brief.schema.json');
const { domains: domaines } = await lireJSON('config', 'sources.json');

const client = createClient({
  url: process.env.DIRECTUS_URL,
  token: process.env.DIRECTUS_TOKEN,
});
const aujourdhui = seoulDate();
console.log(`Ingestion — ${fichiers.length} fichier(s), ${aujourdhui} à Séoul`);

let échec = false;

for (const fichier of fichiers) {
  let issue;
  try {
    issue = await ingérer({
      nom: path.basename(fichier),
      texte: await readFile(fichier, 'utf8'),
      client,
      aujourdhui,
      schéma,
      domaines,
      dire,
      annoter: dire,
    });
  } catch (e) {
    issue = { statut: 'recalé', raison: `erreur pendant l'ingestion : ${e.message}` };
  }

  if (issue.statut !== 'recalé') continue;

  échec = true;
  dire(`   RECALÉ — ${issue.raison}`);
  await tracerLÉchec({
    client,
    brief: issue.brief,
    raison: issue.raison,
    dire,
    avertir: (m) => console.warn(m),
  });
}

if (échec) {
  console.error('\nAu moins un brief a été recalé. Le fichier reste dans inbox/ pour rejeu.');
  process.exitCode = 1;
} else {
  console.log('\nIngestion terminée.');
}
