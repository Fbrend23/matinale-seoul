// Les pop-ups et événements : ce qui est partagé, et ce qui les écarte.
//
// Un événement n'est ni un item ni une rubrique. Il dure au-delà de son brief,
// il a ses propres contrôles, et aucun d'eux ne recale jamais le brief : tout
// ce qui cloche ÉCARTE l'événement, avec un avertissement. C'est cette règle
// — « accessoire, jamais veto » — que ce fichier garde, à côté du lien Naver
// Map, qui est la seule URL que le dépôt s'autorise à construire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  KINDS,
  KIND_LABELS,
  THEMES,
  THEME_LABELS,
  lienNaverMap,
  grouperParÉtat,
} from '../shared/evenements.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lireJSON = async (...b) => JSON.parse(await readFile(path.join(RACINE, ...b), 'utf8'));

const schéma = await lireJSON('schemas', 'brief.schema.json');

// --- Le schéma et le module partagé disent la même chose ---------------------

test('les genres du schéma sont ceux du module partagé, avec chacun son libellé', () => {
  assert.deepEqual(schéma.$defs.event.properties.kind.enum, KINDS);
  for (const kind of KINDS) assert.ok(KIND_LABELS[kind], `pas de libellé pour « ${kind} »`);
});

test('les thèmes du schéma sont ceux du module partagé, avec chacun son libellé', () => {
  assert.deepEqual(schéma.$defs.event.properties.theme.enum, THEMES);
  for (const theme of THEMES) assert.ok(THEME_LABELS[theme], `pas de libellé pour « ${theme} »`);
});

test('pas de thème « autre » : l onglet ne couvre que ses quatre sujets', () => {
  assert.ok(!THEMES.includes('autre'));
});

test('le tableau events est facultatif, et un événement n accepte aucun champ inventé', () => {
  assert.ok(!schéma.required.includes('events'));
  assert.equal(schéma.$defs.event.additionalProperties, false);
});

// --- Le lien Naver Map -------------------------------------------------------

test('le lien Naver Map est une recherche sur le lieu et le quartier', () => {
  const lien = lienNaverMap({ venue: 'Pokémon Center Seoul', area: 'Seongsu' });
  assert.equal(lien, 'https://map.naver.com/p/search/Pok%C3%A9mon%20Center%20Seoul%20Seongsu');
});

test('sans quartier, la recherche porte sur le seul lieu, sans espace traînant', () => {
  assert.equal(lienNaverMap({ venue: 'KSPO Dome', area: null }), 'https://map.naver.com/p/search/KSPO%20Dome');
});

// --- En cours, à venir, terminé ----------------------------------------------

const ev = (name, start_date, end_date) => ({ name, start_date, end_date });

test('un événement se range selon le jour, et les terminés sortent', () => {
  const { enCours, àVenir } = grouperParÉtat(
    [ev('fini', '2026-08-01', '2026-09-03'), ev('ouvert', '2026-09-01', '2026-09-10'), ev('bientôt', '2026-09-05', '2026-09-06')],
    '2026-09-04'
  );

  assert.deepEqual(enCours.map((e) => e.name), ['ouvert']);
  assert.deepEqual(àVenir.map((e) => e.name), ['bientôt']);
});

test('le dernier jour est inclus : un événement qui finit aujourd hui est encore en cours', () => {
  const { enCours } = grouperParÉtat([ev('dernier jour', '2026-09-01', '2026-09-04')], '2026-09-04');
  assert.equal(enCours.length, 1);
});

test('un événement d un seul jour, ce jour-là, est en cours', () => {
  const { enCours, àVenir } = grouperParÉtat([ev('concert', '2026-09-04', '2026-09-04')], '2026-09-04');
  assert.equal(enCours.length, 1);
  assert.equal(àVenir.length, 0);
});

test('l ordre d arrivée est conservé dans chaque groupe', () => {
  const { àVenir } = grouperParÉtat([ev('b', '2026-09-06', '2026-09-06'), ev('a', '2026-09-05', '2026-09-05')], '2026-09-01');
  assert.deepEqual(àVenir.map((e) => e.name), ['b', 'a']);
});
