#!/usr/bin/env node
// Contrôle avant vol : applique au brief tout ce qui peut l'être SANS le CMS.
//
//   node scripts/preflight.mjs inbox/brief-2026-09-07.json
//
// Écrit pour la routine qui rédige le brief : elle a le dépôt cloné, donc elle
// peut se relire avant de pousser au lieu de laisser la CI le lui apprendre.
// Un brief recalé en CI, c'est un run rouge, un mail, et une matinée sans brief.
// Un brief recalé ici, c'est une correction avant même le commit.
//
// Quatre gardes sur cinq. La cinquième — les doublons — interroge Directus, donc
// la CI reste seule juge sur ce point : ce script ne remplace pas l'ingestion, il
// la devance.
//
// Code de sortie : 0 si le brief passerait, 1 sinon.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  validateSchema,
  checkLinks,
  checkAllowlist,
  checkCoherence,
  flatten,
  seoulDate,
} from './lib/guards.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const fichier = process.argv[2];

if (!fichier) {
  console.error('Usage : node scripts/preflight.mjs <inbox/brief-AAAA-MM-JJ.json>');
  process.exit(1);
}

const nom = path.basename(fichier);
const nommage = /^brief-(\d{4}-\d{2}-\d{2})\.json$/.exec(nom);
const problemes = [];

console.log(`Contrôle avant vol — ${nom}\n`);

if (!nommage) {
  problemes.push(`nom de fichier hors format : attendu brief-AAAA-MM-JJ.json`);
}

let brief;
try {
  brief = JSON.parse(await readFile(fichier, 'utf8'));
} catch (e) {
  console.error(`JSON illisible : ${e.message}`);
  process.exit(1);
}

if (nommage && brief.date !== nommage[1]) {
  problemes.push(`le nom dit ${nommage[1]} et le contenu ${brief.date}`);
}

// --- Garde 1 : schéma ---
const schema = JSON.parse(await readFile(path.join(RACINE, 'schemas', 'brief.schema.json'), 'utf8'));
const fautes = validateSchema(brief, schema);
if (fautes.length) {
  problemes.push(...fautes.map((f) => `schéma : ${f}`));
  console.log(`✗ schéma        ${fautes.length} faute(s)`);
} else {
  console.log('✓ schéma');
}

// Sans schéma valide, le reste porterait sur une structure incertaine.
if (!fautes.length) {
  const items = flatten(brief);

  // --- Garde 2 : liens vivants ---
  const sondes = await checkLinks(items);
  const morts = sondes.filter((s) => !s.ok);
  for (const mort of morts) {
    problemes.push(`lien mort : ${mort.item.source_url} (${mort.reason})`);
  }
  console.log(
    morts.length ? `✗ liens         ${morts.length} mort(s) sur ${items.length}` : `✓ liens         ${items.length} vivants`
  );

  // --- Garde 3 : allowlist (avertissement, pas faute) ---
  const { domains } = JSON.parse(await readFile(path.join(RACINE, 'config', 'sources.json'), 'utf8'));
  const inconnus = checkAllowlist(items, domains);
  if (inconnus.length) {
    const hôtes = [...new Set(inconnus.map((i) => i.host))];
    console.log(`! allowlist     ${hôtes.join(', ')}`);
    console.log('                le brief serait ingéré mais RETENU EN BROUILLON,');
    console.log('                donc invisible sur le site jusqu à relecture.');
  } else {
    console.log('✓ allowlist');
  }

  // --- Garde 5 : cohérence, sur les items vivants uniquement ---
  // L'ingestion juge après avoir retiré les liens morts : juger ici sur le brief
  // entier donnerait un verdict que la CI contredirait.
  const vivants = new Set(sondes.filter((s) => s.ok).map((s) => s.item));
  const restant = {
    ...brief,
    sections: brief.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => vivants.has(items.find((x) => x.headline === i.headline && x.source_url === i.source_url))),
    })),
  };
  const incoherences = checkCoherence(restant, { today: seoulDate() });
  if (incoherences.length) {
    problemes.push(...incoherences.map((i) => `cohérence : ${i}`));
    console.log(`✗ cohérence     ${incoherences.length} problème(s)`);
  } else {
    console.log('✓ cohérence');
  }
}

console.log('');

if (problemes.length) {
  console.error('Ce brief serait recalé :\n');
  for (const p of problemes) console.error('  · ' + p);
  console.error('\nCorriger avant de committer.');
  process.exitCode = 1;
} else {
  console.log('Ce brief passerait les gardes. Reste les doublons, que seul le CMS connaît.');
}
