// Le prompt de l'agent et le schéma forment un couple : l'un dit quoi produire,
// l'autre refuse ce qui n'y ressemble pas. Rien ne les tient ensemble, sinon ce
// test.
//
// Sans lui, resserrer le schéma laisserait derrière un prompt qui promet
// l'ancienne forme, et l'agent produirait chaque matin, consciencieusement, des
// briefs que les gardes recaleraient — l'erreur ne se voyant qu'au premier run
// raté, en production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { validateSchema, checkCoherence, SECTIONS } from '../scripts/lib/guards.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');

const prompt = await lire('prompts/brief-quotidien.md');
const schéma = JSON.parse(await lire('schemas/brief.schema.json'));

// Le premier bloc ```json du prompt : l'exemple que l'agent recopiera.
//
// `\r?` n'est pas une précaution de style. Le dépôt normalise en LF
// (.gitattributes, « * text=auto »), mais la copie de travail d'un poste
// Windows porte des CRLF : sans lui, ce test échoue chez le mainteneur et
// passe en CI. Une suite rouge sur la machine où l'on développe est une
// suite qu'on cesse de lire — et celle-ci tient le prompt et le schéma
// ensemble.
const bloc = prompt.match(/```json\r?\n([\s\S]*?)```/);
assert.ok(bloc, "aucun bloc ```json dans le prompt : l'exemple donné à l'agent a disparu");
const exemple = JSON.parse(bloc[1]);

test("l'exemple donné à l'agent passe le schéma", () => {
  assert.deepEqual(validateSchema(exemple, schéma), []);
});

test("l'exemple donné à l'agent passe la garde de cohérence", () => {
  // Daté du jour qu'il annonce : la garde compare à « aujourd'hui à Séoul », ce
  // qui n'a pas de sens pour un exemple figé.
  assert.deepEqual(checkCoherence(exemple, { today: exemple.date }), []);
});

test('le prompt nomme les quatre sections attendues', () => {
  for (const section of SECTIONS) {
    assert.ok(prompt.includes(`\`${section}\``), `section « ${section} » absente du prompt`);
  }
});

test("le prompt donne l'exemple d'un événement, et ses quatre thèmes", async () => {
  // L'onglet n'existe que par ce que l'agent y dépose. Un exemple sans
  // événement, et l'agent n'en écrirait jamais — le schéma l'y autorise sans
  // l'y inviter.
  const { THEMES } = await import('../shared/evenements.mjs');
  assert.ok(Array.isArray(exemple.events) && exemple.events.length > 0, "l'exemple ne porte aucun événement");
  for (const theme of THEMES) {
    assert.ok(prompt.includes(`\`${theme}\``), `thème « ${theme} » absent du prompt`);
  }
  assert.ok(prompt.includes('/api/evenements.json'), "le prompt ne dit pas où lire les événements déjà connus");
});

test('le prompt annonce la bonne limite de mots', async () => {
  const { MAX_SUMMARY_WORDS } = await import('../scripts/lib/guards.mjs');
  assert.ok(
    prompt.includes(`${MAX_SUMMARY_WORDS} mots`),
    `le prompt doit annoncer la limite réelle (${MAX_SUMMARY_WORDS} mots)`
  );
});

test('le prompt donne le chemin de dépôt attendu par le workflow', async () => {
  const workflow = await lire('.github/workflows/publication.yml');
  // Le workflow ne se déclenche que sur ce chemin : un prompt qui en nommerait
  // un autre produirait des commits qui ne lancent rien, sans erreur nulle part.
  assert.ok(workflow.includes("paths: ['inbox/**']"), 'le déclencheur du workflow a changé');
  assert.ok(prompt.includes('inbox/brief-AAAA-MM-JJ.json'), 'le prompt ne donne pas le bon chemin');
});

// --- La documentation, tenue par le code -------------------------------------
//
// Le README désigne cdc.md comme le document qui FAIT FOI. Rien ne l'obligeait
// à rester vrai : l'ajout de la rubrique « gaming » a laissé derrière lui un
// README qui annonçait trois rubriques et un cahier des charges qui décrivait
// un modèle de données à trois valeurs. Une référence fausse est pire qu'une
// référence absente — on la croit.
//
// Ces deux tests coûtent trois lignes et attrapent exactement cette faute, la
// prochaine fois qu'une rubrique sera ajoutée.

/** Les nombres qu'on écrit en toutes lettres dans de la prose française. */
const EN_TOUTES_LETTRES = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six'];

test('le cahier des charges nomme chaque clé de section', async () => {
  const cdc = await lire('cdc.md');
  for (const section of SECTIONS) {
    assert.ok(cdc.includes(`\`${section}\``), `section « ${section} » absente de cdc.md`);
  }
});

test('le README et le cahier des charges annoncent le bon nombre de rubriques', async () => {
  const attendu = `${EN_TOUTES_LETTRES[SECTIONS.length]} rubriques`;
  for (const fichier of ['README.md', 'cdc.md']) {
    const texte = await lire(fichier);
    assert.ok(texte.includes(attendu), `${fichier} devrait annoncer « ${attendu} »`);
  }
});
