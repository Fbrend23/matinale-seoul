#!/usr/bin/env node
// Contrôle hebdomadaire des liens publiés.
//
//   npm run liens
//
// Ce fichier ne décide de rien : il construit le client CMS, lance le
// contrôle de lib/liens-morts.mjs, et dit ce qui a changé. Un lien mort
// n'est pas une panne, c'est ce qu'on est venu chercher : le job sort en
// succès. Seul un CMS qui ne répond pas fait échouer, et c'est le mail.
//
// Codes de sortie :
//   0  contrôle fait, marques posées ou non
//   1  le CMS n'a pas répondu, rien n'a été vérifié
//
// Sur GitHub, `marques=N` est écrit dans GITHUB_OUTPUT : c'est ce qui décide
// de relancer la publication, pour que le site cesse de lier sans attendre
// le lendemain.

import { appendFile } from 'node:fs/promises';
import process from 'node:process';

import { seoulDate } from './lib/guards.mjs';
import { createClient } from './lib/directus.mjs';
import { àSonder, vérifierLiens, marquer, FENÊTRE_JOURS } from './lib/liens-morts.mjs';

const dire = (ligne) => console.log(ligne);

const client = createClient({
  url: process.env.DIRECTUS_URL,
  token: process.env.DIRECTUS_TOKEN,
});

const today = seoulDate();
const cibles = await àSonder(client, { today });
dire(`${cibles.length} lien(s) à sonder, ${FENÊTRE_JOURS} jours en arrière depuis le ${today}.`);

const { morts, ressuscités } = await vérifierLiens(cibles, { dormir: (ms) => new Promise((r) => setTimeout(r, ms)) });

for (const m of morts) dire(`   mort      ${m.collection} #${m.id} ${m.source_url}`);
for (const r of ressuscités) dire(`   revenu    ${r.collection} #${r.id} ${r.source_url}`);

const marques = morts.length + ressuscités.length;
if (marques) {
  await marquer(client, { morts, ressuscités, maintenant: new Date().toISOString() });
  dire(`${morts.length} lien(s) marqué(s) mort(s), ${ressuscités.length} revenu(s).`);
  console.log(`::notice::Liens : ${morts.length} mort(s), ${ressuscités.length} revenu(s), sur ${cibles.length} sondé(s).`);
} else {
  dire('Rien à marquer : tout ce qui répondait répond encore.');
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `marques=${marques}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const lignes = [
    `${cibles.length} lien(s) sondé(s), ${morts.length} mort(s), ${ressuscités.length} revenu(s).`,
    ...morts.map((m) => `- mort : ${m.collection} #${m.id} ${m.source_url}`),
    ...ressuscités.map((r) => `- revenu : ${r.collection} #${r.id} ${r.source_url}`),
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lignes.join('\n') + '\n');
}
