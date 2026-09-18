// Le relevé du quota, testé sans agy.
//
// Ce qui peut mentir ici : une ligne de journal qui dirait « 85 % » d'un
// autre seau que celui qu'on croit, ou un lanceur qui relèverait le quota
// une seule fois, ce qui ne mesure rien.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { lignesDeQuota } from '../scripts/quota.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');

// La forme exacte de `agy -p /usage --output-format json`, relevée le 18 septembre 2026.
const SORTIE = {
  status: 'SUCCESS',
  command: {
    name: 'usage',
    data: {
      groups: [
        { name: 'Gemini Models', buckets: [
          { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.7464887499809265, reset_time: '2026-09-23T22:30:21Z' },
          { id: 'gemini-5h', window: '5h', remaining_fraction: 0.8494138121604919, reset_time: '2026-09-18T08:30:16Z' },
        ] },
        { name: 'Claude and GPT models', buckets: [{ id: '3p-5h', window: '5h', remaining_fraction: 1, reset_time: '2026-09-18T09:06:35Z' }] },
      ],
    },
  },
};

test('une ligne par groupe, le pourcentage arrondi, le reset lisible', () => {
  const lignes = lignesDeQuota(SORTIE);
  assert.equal(lignes.length, 2);
  assert.match(lignes[0], /^quota Gemini : semaine 75 % \(reset [^)]+\), 5 h 85 % \(reset [^)]+\)$/);
  assert.match(lignes[1], /^quota Claude and GPT models : 5 h 100 % \(reset [^)]+\)$/);
  assert.deepEqual(lignesDeQuota({}), []);
  assert.match(lignesDeQuota({ command: { data: { groups: [{ name: 'Gemini', buckets: [{ window: '5h' }] }] } } })[0], /5 h \? \(reset \?\)/);
});

test('le lanceur relève le quota avant la première session Gemini et après la dernière', async () => {
  const lanceur = await lire('bin/brief-du-jour.sh');
  const relevés = [...lanceur.matchAll(/^node scripts\/quota\.mjs$/gm)].map((m) => m.index);
  assert.equal(relevés.length, 2, 'deux relevés, pas un : un seul ne mesure rien');
  assert.ok(relevés[0] < lanceur.indexOf('scripts/actualite.mjs') && relevés[0] < lanceur.indexOf('scripts/recherche.mjs'), 'avant la première session');
  assert.ok(relevés[1] > lanceur.indexOf('scripts/ombre.mjs'), 'après la dernière');
});
