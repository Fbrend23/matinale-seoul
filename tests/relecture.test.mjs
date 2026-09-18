// La relecture avant publication, testée sans réseau et sans Gemini.
//
// Ce qui peut mentir en silence ici, et qui serait publié : une adresse
// « corrigée » par le relecteur, un item ajouté, un brief amputé de moitié
// sans un mot, un brief relu qui remplacerait celui de la session alors que
// le contrôle le recale. Le reste est de l'analyse de texte, et le lanceur,
// qui doit commiter APRÈS la relecture et ne plus laisser git à l'agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { MAX_RETRAITS, composerConsigneRelecture, extraireRelecture, rétablirAdresses, rétablirHeures, vérifierRelecture, écarts, rendreRapport } from '../scripts/lib/relecture.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');
const exécuter = promisify(execFile);

const JOUR = '2026-09-18';

const item = (headline, host, { importance = 1, mots = 12, ...extra } = {}) => ({
  headline,
  original_headline: `${headline} (orig)`,
  summary: Array.from({ length: mots }, (_, i) => `mot${i}`).join(' '),
  importance,
  tags: ['t'],
  source_name: host,
  source_url: `https://${host}/a/${encodeURIComponent(headline)}`,
  source_lang: 'en',
  ...extra,
});
const briefDe = (parSection, events) => ({
  date: JOUR,
  title: 'Titre',
  standfirst: 'Chapeau.',
  sections: ['tourisme', 'coree', 'tech', 'gaming', 'sport'].map((key) => ({
    key,
    empty_note: parSection[key]?.length ? null : 'Rien.',
    items: parSection[key] ?? [],
  })),
  ...(events ? { events } : {}),
});
const EVENT = {
  name: 'Pop-up', kind: 'popup', theme: 'mode', venue: '더현대 서울', area: 'Yeouido',
  start_date: '2026-09-18', end_date: '2026-09-20', summary: 'S.',
  source_name: 'Korea Herald', source_url: 'https://www.koreaherald.com/e/1', source_lang: 'en', booking_url: 'https://tickets.interpark.com/x',
};
const ORIGINAL = briefDe({
  coree: [item('A', 'www.koreaherald.com'), item('B', 'www.koreatimes.co.kr', { importance: 2 })],
  tech: [item('C', 'techcrunch.com', { analysis: 'Pourquoi.' })],
}, [EVENT]);
const clone = (o) => JSON.parse(JSON.stringify(o));

test('la consigne porte le jour et le brief entier, et nomme ce que le relecteur ne fait jamais', async () => {
  const gabarit = await lire('prompts/relecture.md');
  for (const g of ['{{JOUR}}', '{{BRIEF}}']) assert.ok(gabarit.includes(g), `${g} absent`);
  const consigne = composerConsigneRelecture(gabarit, { jour: JOUR, brief: ORIGINAL });
  assert.ok(!/\{\{[A-Z]+\}\}/.test(consigne), 'un gabarit est resté');
  assert.match(consigne, /Nous sommes le 2026-09-18/);
  assert.match(consigne, /"source_url": "https:\/\/www\.koreaherald\.com\/a\/A"/);
  for (const règle of ["Tu n'ajoutes rien", 'Tu ne changes aucune adresse', '40 mots', 'tu ne cherches rien sur le web', 'tu ne lances aucune commande']) {
    assert.ok(consigne.includes(règle), `règle « ${règle} » absente`);
  }
  const { MAX_SUMMARY_WORDS } = await import('../scripts/lib/guards.mjs');
  assert.ok(consigne.includes(`${MAX_SUMMARY_WORDS} mots`), 'la consigne doit annoncer la limite réelle');
});

test('la réponse se lit avec ou sans enveloppe, et une réponse sans brief est une panne', () => {
  const avec = extraireRelecture(`Voici.\n\`\`\`json\n${JSON.stringify({ corrections: [{ cible: 'coree/1', champ: 'summary', pourquoi: 'x' }, null], brief: ORIGINAL })}\n\`\`\``);
  assert.equal(avec.corrections.length, 1);
  assert.deepEqual(avec.brief, ORIGINAL);
  const nu = extraireRelecture(JSON.stringify(ORIGINAL));
  assert.deepEqual(nu, { corrections: [], brief: ORIGINAL });
  assert.ok(!('events' in extraireRelecture(JSON.stringify({ ...ORIGINAL, events: [] })).brief), 'un tableau d\'événements vide s\'omet');
  assert.throws(() => extraireRelecture('{"corrections": []}'), /ni `brief` ni `sections`/);
  assert.throws(() => extraireRelecture('rien'), /aucun objet/);
});

test('une relecture qui ne fait que relire est acceptée, écarts compris', () => {
  const relu = clone(ORIGINAL);
  relu.title = 'Autre titre';
  relu.sections[1].items[0].summary = 'Résumé corrigé.';
  relu.sections[1].items[0].published_at = '2026-09-18T07:00:00+09:00';
  relu.events[0].end_date = '2026-09-21';
  delete relu.events[0].booking_url;
  assert.deepEqual(vérifierRelecture(ORIGINAL, { corrections: [], brief: relu }), []);
  const liste = écarts(ORIGINAL, relu);
  assert.deepEqual(liste.map((e) => `${e.cible} · ${e.champ}`), ['title · title', 'coree/1 · summary', 'coree/1 · published_at', 'events/0 · end_date', 'events/0 · booking_url']);
  assert.equal(liste[1].avant.split(' ').length, 12);
  assert.equal(liste[1].après, 'Résumé corrigé.');
  assert.deepEqual(écarts(ORIGINAL, clone(ORIGINAL)), []);
});

test('un item retiré et nommé passe ; un item retiré sans un mot, ou trop d\'items, non', () => {
  const relu = clone(ORIGINAL);
  relu.sections[1].items.splice(1, 1);
  assert.deepEqual(vérifierRelecture(ORIGINAL, { corrections: [{ cible: 'coree/2', champ: 'item', pourquoi: 'La page dit autre chose.' }], brief: relu }), []);
  assert.match(vérifierRelecture(ORIGINAL, { corrections: [], brief: relu })[0], /1 retrait\(s\) constaté\(s\), 0 expliqué\(s\)/);
  assert.deepEqual(écarts(ORIGINAL, relu), [{ cible: 'coree/2', champ: 'item', avant: 'B', après: null }]);

  // Un item qui change de section n'est pas un retrait.
  const déplacé = clone(ORIGINAL);
  déplacé.sections[2].items.push({ ...déplacé.sections[1].items.pop(), importance: 2 });
  assert.deepEqual(vérifierRelecture(ORIGINAL, { corrections: [], brief: déplacé }), []);
  assert.ok(écarts(ORIGINAL, déplacé).some((e) => e.cible === 'coree/2' && e.champ === 'section' && e.après === 'tech'));

  // Trop de retraits : une panne, pas un jugement.
  const gros = briefDe({ coree: Array.from({ length: MAX_RETRAITS + 2 }, (_, i) => item(`I${i}`, 'www.koreaherald.com', { importance: i + 1 })), tech: [item('C', 'techcrunch.com')] });
  const amputé = clone(gros);
  amputé.sections[1].items = [];
  amputé.sections[1].empty_note = 'Vidée.';
  const nommés = Array.from({ length: MAX_RETRAITS + 2 }, () => ({ champ: 'item', pourquoi: 'x' }));
  assert.match(vérifierRelecture(gros, { corrections: nommés, brief: amputé }).join(' ; '), new RegExp(`${MAX_RETRAITS + 2} items retirés, ${MAX_RETRAITS} au plus`));
});

test('une adresse qui ne diffère que par la forme est rétablie à la lettre ; une autre reste autre', () => {
  // Le 18 septembre 2026, à l'essai : `…behavior/` rendu `…behavior//`.
  const relu = clone(ORIGINAL);
  relu.sections[1].items[0].source_url = 'https://www.koreaherald.com/a/A/';
  relu.sections[1].items[1].source_url = 'https://www.koreatimes.co.kr/a/B?utm_source=rss';
  relu.events[0].booking_url = 'https://tickets.interpark.com/x#haut';
  relu.sections[2].items[0].source_url = 'https://techcrunch.com/a/autre';
  rétablirAdresses(ORIGINAL, relu);
  assert.equal(relu.sections[1].items[0].source_url, ORIGINAL.sections[1].items[0].source_url);
  assert.equal(relu.sections[1].items[1].source_url, ORIGINAL.sections[1].items[1].source_url);
  assert.equal(relu.events[0].booking_url, ORIGINAL.events[0].booking_url);
  assert.equal(relu.sections[2].items[0].source_url, 'https://techcrunch.com/a/autre');
  assert.deepEqual(vérifierRelecture(ORIGINAL, { corrections: [], brief: relu }).length, 2, 'l\'adresse autre est refusée, et son item compte pour retiré');
});

test('une heure réécrite dans un autre fuseau est rétablie ; un autre instant reste une correction', () => {
  // Le 18 septembre 2026, à l'essai : 05:34:24+09:00 rendu 13:34:24-07:00.
  const original = clone(ORIGINAL);
  original.sections[1].items[0].published_at = '2026-09-18T05:34:24+09:00';
  original.sections[1].items[1].published_at = '2026-09-18T07:27:02+09:00';
  const relu = clone(original);
  relu.sections[1].items[0].published_at = '2026-09-17T13:34:24-07:00';
  relu.sections[1].items[1].published_at = '2026-09-18T01:37:03+09:00';
  rétablirHeures(original, relu);
  assert.equal(relu.sections[1].items[0].published_at, '2026-09-18T05:34:24+09:00');
  assert.equal(relu.sections[1].items[1].published_at, '2026-09-18T01:37:03+09:00');
});

test('deux événements à la même source restent chacun le sien, apparié par le nom', () => {
  // Le 18 septembre 2026 : un programme de la ville source deux événements.
  const source = 'https://festival.seoul.go.kr/programme';
  const original = briefDe({ coree: [item('A', 'www.koreaherald.com')], tech: [item('C', 'techcrunch.com')] }, [
    { ...EVENT, name: 'Théâtre du jardin des nuits d\'automne', venue: '서울숲', source_url: source, booking_url: undefined },
    { ...EVENT, name: 'Journée sportive à Seoul Plaza', venue: '서울광장', source_url: source, booking_url: undefined },
  ]);
  const relu = clone(original);
  relu.events[1].summary = 'Corrigé.';
  assert.deepEqual(vérifierRelecture(original, { corrections: [], brief: relu }), []);
  assert.deepEqual(écarts(original, relu), [{ cible: 'events/1', champ: 'summary', avant: 'S.', après: 'Corrigé.' }]);
  // Le premier retiré : c'est lui qui manque, pas le second.
  relu.events.splice(0, 1);
  assert.deepEqual(écarts(original, relu).map((e) => `${e.cible} · ${e.champ}`), ['events/0 · event', 'events/1 · summary']);
  assert.deepEqual(vérifierRelecture(original, { corrections: [{ champ: 'event', pourquoi: 'x' }], brief: relu }), []);
});

test('une adresse nouvelle, un item de plus, une date ou des sections changées sont refusés', () => {
  const adresse = clone(ORIGINAL);
  adresse.sections[1].items[0].source_url = 'https://www.koreaherald.com/a/corrigee';
  const raisons = vérifierRelecture(ORIGINAL, { corrections: [{ champ: 'item' }], brief: adresse });
  assert.ok(raisons.some((r) => /adresse\(s\) qui n'étaient pas dans le brief reçu : https:\/\/www\.koreaherald\.com\/a\/corrigee/.test(r)), raisons.join(' ; '));

  const billet = clone(ORIGINAL);
  billet.events[0].booking_url = 'https://tickets.interpark.com/autre';
  assert.ok(vérifierRelecture(ORIGINAL, { corrections: [], brief: billet }).some((r) => /interpark\.com\/autre/.test(r)));

  const ajout = clone(ORIGINAL);
  ajout.sections[4].items.push(item('A', 'www.koreaherald.com'));
  ajout.sections[4].empty_note = null;
  assert.ok(vérifierRelecture(ORIGINAL, { corrections: [], brief: ajout }).some((r) => /plus d'items qu'à la réception : 3 → 4/.test(r)));

  const date = clone(ORIGINAL);
  date.date = '2026-09-17';
  assert.ok(vérifierRelecture(ORIGINAL, { corrections: [], brief: date }).some((r) => /la date a changé/.test(r)));

  const sections = clone(ORIGINAL);
  sections.sections.reverse();
  assert.ok(vérifierRelecture(ORIGINAL, { corrections: [], brief: sections }).some((r) => /les sections ont changé/.test(r)));

  assert.deepEqual(vérifierRelecture(ORIGINAL, { corrections: [], brief: { date: JOUR } }), ['le brief rendu n\'a pas de sections']);
});

test('le rapport met côte à côte ce que le relecteur dit et ce que le dépôt constate', () => {
  const md = rendreRapport({
    jour: JOUR,
    sort: 'appliquée',
    corrections: [{ cible: 'coree/1', champ: 'summary', pourquoi: 'Chiffre faux.' }],
    écarts: [{ cible: 'coree/1', champ: 'summary', avant: 'a'.repeat(200), après: 'court' }],
    session: { modèle: 'gemini-x', durée: 300.6, tours: 2, usage: { input_tokens: 10, output_tokens: 5 } },
    verdict: '✓ schéma\n',
  });
  assert.match(md, /^# Relecture du 2026-09-18\n\nGemini \(gemini-x\) : 301 s, 2 tours, 10 tokens lus, 5 écrits\.\nRelecture \*\*appliquée\*\*\./);
  assert.match(md, /## Ce que le relecteur dit avoir changé\n\n- coree\/1 · summary : Chiffre faux\./);
  assert.match(md, /## Ce qui a changé, constaté\n\n- \*\*coree\/1 · summary\*\*\n  avant : a{117}…\n  après : court/);
  assert.match(md, /## Contrôle avant vol du brief relu\n\n```\n✓ schéma\n```/);
  assert.match(rendreRapport({ jour: JOUR, sort: 'sans changement' }), /Aucun écart entre le brief reçu et le brief rendu\./);
  assert.match(rendreRapport({ jour: JOUR, sort: 'refusée', raison: 'la date a changé' }), /Relecture \*\*refusée\*\* : la date a changé\./);
});

// --- Le script, de bout en bout, avec un faux Gemini ----------------------------

test('le script remplace le brief seulement si la relecture est acceptée et passe le contrôle', async (t) => {
  await mkdir(path.join(RACINE, 'veille'), { recursive: true });
  const dossier = await mkdtemp(path.join(RACINE, 'veille', 'test-relecture-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const fichier = path.join(dossier, `brief-${JOUR}.json`);
  const rapports = path.join(dossier, 'relecture');
  const réponse = (objet) => JSON.stringify({ status: 'SUCCESS', num_turns: 5, duration_seconds: 20, response: JSON.stringify(objet) });
  const faux = async (nom, objet) => {
    const chemin = path.join(dossier, nom);
    await writeFile(chemin, `#!/bin/sh\nprintf '%s' '${réponse(objet).replaceAll("'", "'\\''")}'\n`, { mode: 0o755 });
    return chemin;
  };
  const lancer = (commande) =>
    exécuter('node', ['scripts/relecture.mjs', '--jour', JOUR, '--fichier', fichier, '--dossier', rapports], {
      cwd: RACINE,
      env: { ...process.env, MATINALE_GEMINI: commande, SITE_URL: 'http://127.0.0.1:9' },
    }).catch((e) => e);

  // Refusée : une adresse corrigée. Le fichier ne bouge pas, le rapport le dit.
  const adresse = clone(ORIGINAL);
  adresse.sections[1].items[0].source_url = 'https://www.koreaherald.com/a/corrigee';
  await writeFile(fichier, `${JSON.stringify(ORIGINAL, null, 2)}\n`);
  let r = await lancer(await faux('refus.sh', { corrections: [], brief: adresse }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /! relecture\s+refusée, le brief de la session part tel quel :\n\s+· adresse\(s\) qui n'étaient pas dans le brief reçu/);
  assert.deepEqual(JSON.parse(await readFile(fichier, 'utf8')), ORIGINAL);
  assert.match(await readFile(path.join(rapports, `relecture-${JOUR}.md`), 'utf8'), /Relecture \*\*refusée\*\*/);

  // Sans changement : rien n'est écrit, et le code de sortie est 0.
  r = await lancer(await faux('pareil.sh', { corrections: [], brief: ORIGINAL }));
  assert.equal(r.code ?? 0, 0);
  assert.match(r.stdout, /✓ relecture\s+rien à changer/);

  // Recalée : un résumé de 41 mots. Le contrôle le dit, le fichier ne bouge pas.
  // Les liens ne répondent pas ici non plus, le contrôle recale aussi pour
  // eux : ce qu'on vérifie est le chemin, pas le motif.
  const long = clone(ORIGINAL);
  long.sections[1].items[0].summary = Array.from({ length: 41 }, (_, i) => `m${i}`).join(' ');
  r = await lancer(await faux('long.sh', { corrections: [{ cible: 'coree/1', champ: 'summary', pourquoi: 'x' }], brief: long }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /! relecture\s+le brief relu serait recalé/);
  assert.deepEqual(JSON.parse(await readFile(fichier, 'utf8')), ORIGINAL);
  assert.ok(await readFile(path.join(rapports, `brief-${JOUR}.json`), 'utf8'), 'le brief relu est déposé à côté, pour lecture');

  // Sans brief : rien à relire.
  r = await exécuter('node', ['scripts/relecture.mjs', '--jour', '2026-09-19', '--fichier', path.join(dossier, 'absent.json'), '--dossier', rapports], { cwd: RACINE }).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /pas de brief à relire/);
});

// Le chemin « appliquée », lui, ne se joue pas hors réseau : le schéma exige
// des adresses en https et la garde des liens les sonde, il n'existe donc pas
// de brief que le contrôle accepte sans sortir. Ce chemin est trois lignes,
// écrire le fichier et le rapport, et le journal du serveur le montre chaque
// matin où Gemini a relu.

// --- Ce qui tient les pièces ensemble -------------------------------------------

test('le lanceur relit après la session, contrôle, puis commite lui-même, et l\'agent n\'a plus git', async () => {
  const lanceur = await lire('bin/brief-du-jour.sh');
  const session = lanceur.indexOf('claude -p');
  const relecture = lanceur.indexOf('scripts/relecture.mjs');
  const contrôle = lanceur.indexOf('scripts/preflight.mjs "$ATTENDU"');
  const commit = lanceur.indexOf('git commit');
  const push = lanceur.indexOf('git push');
  assert.ok(session > 0 && relecture > session, 'la relecture vient après la session');
  assert.ok(contrôle > relecture, 'le contrôle du lanceur vient après la relecture');
  assert.ok(commit > contrôle && push > commit, 'le commit vient après le contrôle, le push après le commit');
  assert.match(lanceur, /scripts\/relecture\.mjs[^\n]*\|\| echo/);
  assert.match(lanceur, /scripts\/preflight\.mjs "\$ATTENDU" \|\| echec/);
  assert.match(lanceur, /git add "\$ATTENDU"/);
  const outils = /--allowedTools ([^\n]+)/.exec(lanceur)[1];
  assert.ok(!/git/.test(outils), `l'agent a encore git : ${outils}`);
  const consigne = await lire('prompts/consigne-serveur.txt');
  assert.match(consigne, /Ne commite pas, ne pousse pas/);
  const prompt = await lire('prompts/brief-quotidien.md');
  assert.match(prompt, /Tu ne le commites pas et tu ne pousses rien/);
});

test('la relecture ne contourne pas les permissions', async () => {
  for (const fichier of ['scripts/relecture.mjs', 'scripts/actualite.mjs', 'scripts/lib/relecture.mjs', 'scripts/lib/actualite.mjs']) {
    const code = (await lire(fichier)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/dangerously-skip-permissions|--yolo|approval-mode/.test(code), `${fichier} lève les permissions`);
  }
});
