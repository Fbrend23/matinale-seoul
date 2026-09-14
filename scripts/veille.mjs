#!/usr/bin/env node
// La veille du matin : relève les flux RSS des rédactions connues et ce que le
// site a déjà publié, et les dépose dans veille/ pour la session de rédaction.
//
//   node scripts/veille.mjs                  # le jour courant à Séoul
//   node scripts/veille.mjs --jour 2026-09-14
//
// Un seul fichier, que le prompt fait lire à l'agent en un tour,
// veille/AAAA-MM-JJ.md : ce que le site a déjà publié (titres des quatorze
// derniers briefs, onglet événements), puis les titres parus depuis trente
// heures, par rédaction.
//
// Les deux JSON du site sont ceux que l'agent allait chercher lui-même par
// WebFetch, résumés au passage par un petit modèle qui tronquait la liste, si
// bien qu'il les redemandait. Ici ils sont exacts, réduits aux titres, et lus
// une fois.
//
// Rien ici n'est bloquant pour la parution : un flux en panne est un flux en
// moins, un site injoignable laisse le JSON absent, et le prompt prévoit les
// deux. Le code de sortie ne dit que si le dossier a pu être écrit.

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { releverVeille, rendreVeille } from './lib/veille.mjs';
import { seoulToday } from '../shared/date.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const SITE = (process.env.SITE_URL ?? 'https://matinale.brendanfleurdelys.ch').replace(/\/$/, '');
const HEURES = 30;

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const jour = option('--jour') ?? seoulToday();
const dossier = path.join(RACINE, option('--dossier') ?? 'veille');

const { flux } = JSON.parse(readFileSync(path.join(RACINE, 'config/flux.json'), 'utf8'));

/** Un JSON du site ; `{ panne }` s'il est hors d'atteinte ou mal formé. */
async function rapatrier(chemin, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SITE}${chemin}`, { signal: controller.signal });
    if (!res.ok) return { panne: `HTTP ${res.status}` };
    return { json: await res.json() };
  } catch (e) {
    return { panne: e.name === 'AbortError' ? `délai de ${timeoutMs} ms dépassé` : e.message };
  } finally {
    clearTimeout(minuteur);
  }
}

await mkdir(dossier, { recursive: true });

const maintenant = new Date();
const [veille, recent, evenements] = await Promise.all([
  releverVeille(flux, { maintenant, heures: HEURES }),
  rapatrier('/api/recent.json'),
  rapatrier('/api/evenements.json'),
]);

const sortie = path.join(dossier, `${jour}.md`);
await writeFile(
  sortie,
  rendreVeille(veille, { jour, maintenant, heures: HEURES, recent: recent.json ?? null, evenements: evenements.json ?? null })
);

for (const r of veille.relevés) {
  console.log(`${r.panne ? '!' : '✓'} ${r.source_name.padEnd(18)} ${r.panne ?? `${r.entrées.length} titres`}`);
}
for (const [nom, r] of [['recent.json', recent], ['evenements.json', evenements]]) {
  console.log(`${r.panne ? '!' : '✓'} ${nom.padEnd(18)} ${r.panne ?? 'rapatrié'}`);
}
const titres = veille.relevés.reduce((n, r) => n + r.entrées.length, 0);
console.log(`veille écrite : ${path.relative(RACINE, sortie)} (${titres} titres, ${veille.pannes.length} flux en panne)`);
