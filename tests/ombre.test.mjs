// Le brief en ombre, testé sans réseau et sans Gemini.
//
// Ce qui peut mentir en silence ici : un exemple de brief qui divergerait de
// celui de la session, et Gemini rendrait consciencieusement une forme que le
// schéma recale ; un brief recalé déposé comme s'il passait ; une comparaison
// qui compte de travers. Le reste est de l'analyse de texte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { exempleDuPrompt, composerConsigneOmbre, consigneDeCorrection, extraireObjet, comparer } from '../scripts/lib/ombre.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');
const exécuter = promisify(execFile);

test('l\'exemple de l\'ombre est celui de la session, et il passe le schéma', async () => {
  const exemple = exempleDuPrompt(await lire('prompts/brief-quotidien.md'));
  const { validateSchema } = await import('../scripts/lib/guards.mjs');
  const schéma = JSON.parse(await lire('schemas/brief.schema.json'));
  assert.deepEqual(validateSchema(JSON.parse(exemple), schéma), []);
  assert.throws(() => exempleDuPrompt('# Rien\n\n```json\n[1, 2]\n```\n'), /aucun exemple/);
});

test('la consigne reçoit le jour, la veille, l\'allowlist et l\'exemple, et nomme chaque règle qui recale', async () => {
  const gabarit = await lire('prompts/brief-ombre.md');
  for (const g of ['{{JOUR}}', '{{VEILLE}}', '{{DOMAINES}}', '{{EXEMPLE}}']) assert.ok(gabarit.includes(g), `${g} absent`);
  const consigne = composerConsigneOmbre(gabarit, {
    jour: '2026-09-16',
    veille: 'veille/2026-09-16.md',
    domaines: ['koreaherald.com', 'techcrunch.com'],
    exemple: '{"date": "2026-09-16"}',
  });
  assert.ok(!/\{\{[A-Z]+\}\}/.test(consigne), 'un gabarit est resté');
  assert.match(consigne, /lis `veille\/2026-09-16\.md`/);
  assert.match(consigne, /koreaherald\.com, techcrunch\.com/);
  assert.match(consigne, /```json\n\{"date": "2026-09-16"\}\n```/);
  // Les cinq sections dans l'ordre, les thèmes d'événement, et les mots des gardes.
  assert.match(consigne, /`tourisme`, `coree`, `tech`, `gaming`, `sport`/);
  const { THEMES } = await import('../shared/evenements.mjs');
  for (const theme of THEMES) assert.ok(consigne.includes(`\`${theme}\``), `thème « ${theme} » absent`);
  for (const règle of ['40 mots', 'empty_note', 'importance', 'original_headline', 'Ne reconstruis jamais une URL']) {
    assert.ok(consigne.includes(règle), `règle « ${règle} » absente`);
  }
  // L'ombre ne cherche pas, ne commite pas, ne lance rien.
  assert.match(consigne, /Ne cherche rien sur le web/);
  assert.match(consigne, /tu ne commites rien/);
});

test('la correction reçoit le verdict et le brief entier, et demande l\'objet entier', () => {
  const consigne = consigneDeCorrection('2026-09-16', { date: '2026-09-16', title: 'T' }, '✗ schéma   1 faute\n');
  assert.match(consigne, /## Verdict du contrôle\n\n```\n✗ schéma   1 faute\n```/);
  assert.match(consigne, /"title": "T"/);
  assert.match(consigne, /Rends l'objet JSON entier/);
});

test('l\'objet se lit malgré une phrase avant et une clôture de code, et une réponse sans objet est une panne', () => {
  assert.deepEqual(extraireObjet('Voici :\n```json\n{"date": "2026-09-16", "sections": []}\n```\n'), { date: '2026-09-16', sections: [] });
  assert.throws(() => extraireObjet('[1, 2]'), /aucun objet/);
  assert.throws(() => extraireObjet('{"a": 1,}'), /illisible/);
});

const item = (headline, host, mots = 12) => ({
  headline,
  summary: Array.from({ length: mots }, (_, i) => `mot${i}`).join(' '),
  importance: 1,
  tags: ['t'],
  source_name: host,
  source_url: `https://${host}/a/${encodeURIComponent(headline)}`,
  source_lang: 'en',
});
const briefDe = (title, parSection, events = []) => ({
  date: '2026-09-16',
  title,
  standfirst: 'S.',
  sections: ['tourisme', 'coree', 'tech', 'gaming', 'sport'].map((key) => ({
    key,
    empty_note: parSection[key]?.length ? null : 'Rien.',
    items: parSection[key] ?? [],
  })),
  ...(events.length ? { events } : {}),
});

test('la comparaison compte les deux briefs et met les titres côte à côte', () => {
  const ombre = briefDe('Ombre', {
    coree: [item('A', 'www.koreaherald.com'), item('B', 'www.koreatimes.co.kr', 45)],
    tech: [item('C', 'techcrunch.com')],
  }, [{ name: 'Pop-up', theme: 'mode', start_date: '2026-09-18', end_date: '2026-09-20', venue: '더현대 서울' }]);
  const référence = briefDe('Session', {
    coree: [item('A bis', 'www.koreaherald.com')],
    tech: [item('C', 'arstechnica.com'), item('D', 'techcrunch.com')],
  });
  const md = comparer({
    jour: '2026-09-16',
    ombre,
    référence,
    verdict: { passe: true, tours: 2 },
    session: { modèle: 'gemini-x', durée: 400.4, tours: 3, usage: { input_tokens: 10, output_tokens: 5 } },
    fichiers: { ombre: 'veille/ombre/brief-2026-09-16.json', référence: 'inbox/brief-2026-09-16.json' },
  });
  assert.match(md, /^# Ombre du 2026-09-16\n/);
  assert.match(md, /Gemini \(gemini-x\) : 400 s, 3 tours, 10 tokens lus, 5 écrits\./);
  assert.match(md, /Contrôle avant vol : passe après 2 passage\(s\)\./);
  assert.match(md, /\| Items \| 3 \| 3 \|/);
  assert.match(md, /\| Domaines sources \| 3 \| 3 \|/);
  assert.match(md, /\| Mots par résumé \(moy\.\) \| 23 \(1 > 40\) \| 12 \|/);
  assert.match(md, /\| Événements \| 1 \| 0 \|/);
  assert.match(md, /## coree · ombre 2 · session 1\n\n- \[ombre\] A — koreaherald\.com\n- \[ombre\] B — koreatimes\.co\.kr\n- \[session\] A bis — koreaherald\.com/);
  assert.match(md, /## tourisme · ombre 0 · session 0\n\nOmbre, section vide : Rien\.\n\nSession, section vide : Rien\./);
  assert.match(md, /- \[ombre\] Pop-up · mode · 2026-09-18 → 2026-09-20 · 더현대 서울/);
  assert.match(md, /en commun koreaherald\.com, techcrunch\.com\./);

  // Sans brief de session, la comparaison le dit et ne compare pas à du vide.
  const seule = comparer({ jour: '2026-09-16', ombre, référence: null, verdict: { passe: false, tours: 1 }, fichiers: { ombre: 'x.json' } });
  assert.match(seule, /pas de brief de session ce matin/);
  assert.match(seule, /\| Items \| 3 \| — \|/);
  assert.match(seule, /RECALÉ après 1 passage/);
});

// --- Le script, de bout en bout, avec un faux Gemini ----------------------------

test('le script dépose le brief de Gemini, le contrôle, corrige une fois, et compare à la session', async (t) => {
  await mkdir(path.join(RACINE, 'veille'), { recursive: true });
  const dossier = await mkdtemp(path.join(RACINE, 'veille', 'test-ombre-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const jour = '2026-09-16';
  await writeFile(path.join(dossier, `${jour}.md`), '# Veille de test\n');

  // Le faux répond la forme exacte de `agy --output-format json`. Au premier
  // appel, un brief dont un résumé fait 41 mots : le contrôle le recale. Au
  // second, la consigne de correction (elle porte « Verdict »), le même
  // brief, coupé. Les liens visent des adresses qui ne répondent pas ici :
  // ils feraient recaler le contrôle sans qu'on puisse le distinguer du
  // résumé ; on désigne donc un site muet ET on lit le verdict du schéma.
  const long = briefDe('Ombre', { coree: [item('A', 'www.koreaherald.com', 41)], tech: [item('C', 'techcrunch.com')] });
  const court = briefDe('Ombre', { coree: [item('A', 'www.koreaherald.com', 30)], tech: [item('C', 'techcrunch.com')] });
  const réponse = (brief) => JSON.stringify({ status: 'SUCCESS', num_turns: 4, duration_seconds: 12.5, response: JSON.stringify(brief) });
  const faux = path.join(dossier, 'faux-agy.sh');
  await writeFile(
    faux,
    `#!/bin/sh\ncase "$2" in *"## Verdict du contrôle"*) printf '%s' '${réponse(court).replaceAll("'", "'\\''")}' ;; *) printf '%s' '${réponse(long).replaceAll("'", "'\\''")}' ;; esac\n`,
    { mode: 0o755 }
  );

  const env = { ...process.env, MATINALE_GEMINI: faux, SITE_URL: 'http://127.0.0.1:9' };
  const argv = ['scripts/ombre.mjs', '--jour', jour, '--veille', dossier, '--dossier', path.join(dossier, 'ombre')];
  // Les liens ne répondent pas ici : le contrôle recale aussi pour eux, et
  // le code de sortie le dit. Ce qu'on vérifie, c'est le chemin : dépôt,
  // contrôle, correction, second contrôle, comparaison.
  const { stdout } = await exécuter('node', argv, { cwd: RACINE, env }).catch((e) => e);
  assert.match(stdout, /✓ Gemini ombre\s+brief rendu en \d+ s, 4 tours/);
  assert.match(stdout, /! contrôle\s+recalé au premier passage/);
  assert.match(stdout, /contrôle\s+(passe|toujours recalé) après correction 1/);
  assert.match(stdout, /ombre écrite : .*brief-2026-09-16\.json \(tourisme 0, coree 1, tech 1, gaming 0, sport 0 ; 0 événements\)/);
  assert.match(stdout, /comparaison   : .*ombre-2026-09-16\.md/);

  const déposé = JSON.parse(await readFile(path.join(dossier, 'ombre', `brief-${jour}.json`), 'utf8'));
  assert.equal(déposé.sections[1].items[0].summary.split(' ').length, 30, 'le brief déposé est le corrigé');
  const md = await readFile(path.join(dossier, 'ombre', `ombre-${jour}.md`), 'utf8');
  assert.match(md, /^# Ombre du 2026-09-16/);
  assert.match(md, /Gemini \(gemini-3\.8-flash-high\)/);
  assert.match(md, /- \[ombre\] A — koreaherald\.com/);

  // Sans veille, rien à lire, et le code de sortie le dit.
  await assert.rejects(
    exécuter('node', ['scripts/ombre.mjs', '--jour', '2026-09-17', '--veille', dossier, '--dossier', path.join(dossier, 'ombre')], { cwd: RACINE, env }),
    ({ code, stdout }) => code === 1 && /pas de veille pour le 2026-09-17/.test(stdout)
  );
});

// --- Ce qui tient les pièces ensemble -------------------------------------------

test('ni l\'ombre ni la recherche ne contournent les permissions', async () => {
  for (const fichier of ['scripts/ombre.mjs', 'scripts/recherche.mjs', 'scripts/lib/agy.mjs']) {
    const code = (await lire(fichier)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/dangerously-skip-permissions|--yolo|approval-mode/.test(code), `${fichier} lève les permissions`);
  }
});

test('le lanceur lance l\'ombre après la session, sans s\'arrêter dessus', async () => {
  const lanceur = await lire('bin/brief-du-jour.sh');
  assert.ok(lanceur.includes('scripts/ombre.mjs'), 'le lanceur ne lance pas l\'ombre');
  assert.ok(lanceur.indexOf('claude -p') < lanceur.indexOf('scripts/ombre.mjs'), 'l\'ombre compare à la session : elle vient après');
  assert.match(lanceur, /scripts\/ombre\.mjs[^\n]*\|\| echo/);
});
