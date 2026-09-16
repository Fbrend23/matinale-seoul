// La recherche d'événements, testée sans réseau et sans Gemini.
//
// Ce qui peut mentir en silence ici : une piste de Gemini qui atteindrait
// l'agent sans avoir passé le tri de l'ingestion, l'agent la tiendrait pour
// vérifiée ; une adresse de renvoi Google jugée à la place de la page
// d'arrivée ; un champ de trop recopié dans le brief, qui ferait recaler le
// fichier entier au schéma. Le reste est de l'analyse de texte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { composerConsigne, extraireTableau, épurer, résoudre, trierPistes, rendrePistes, lieuEnCoréen, VOLETS } from '../scripts/lib/recherche.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');
const exécuter = promisify(execFile);

const TODAY = '2026-09-15';
const DOMAINES = ['inven.co.kr', 'koreaherald.com', 'insideseoul.app'];

const PISTE = {
  name: 'Pop-up Chiikawa à Seongsu',
  kind: 'popup',
  theme: 'personnages',
  venue: '무신사 스퀘어 성수',
  area: 'Seongsu',
  start_date: '2026-09-18',
  end_date: '2026-10-05',
  summary: 'Boutique éphémère Chiikawa, produits exclusifs, entrée libre.',
  source_name: 'Inven',
  source_url: 'https://www.inven.co.kr/webzine/news/?news=300001',
  source_lang: 'ko',
};

/** Un fetch qui répond 200 partout, et suit une redirection Google vers Inven. */
const fetcher = async (url, init = {}) => {
  const arrivée = url.startsWith('https://vertexaisearch.cloud.google.com/')
    ? 'https://www.inven.co.kr/webzine/news/?news=300002'
    : url;
  return { ok: true, status: 200, url: arrivée, text: async () => '', json: async () => ({}) };
};

test('la consigne reçoit le jour, l\'onglet et l\'allowlist, et dit quand l\'onglet est vide', () => {
  const gabarit = 'Jour {{JOUR}}\n{{CONNUS}}\n{{DOMAINES}}\n{{METHODE}}';
  const avec = composerConsigne(gabarit, {
    jour: TODAY,
    connus: [{ name: 'Méga Festa', theme: 'pokemon', start_date: '2026-09-01', end_date: '2026-09-30', venue: '코엑스' }],
    domaines: DOMAINES,
    méthode: '\nLis les pages.\n',
  });
  assert.match(avec, /^Jour 2026-09-15\n- 2026-09-01 → 2026-09-30 · pokemon · Méga Festa · 코엑스\ninven\.co\.kr, koreaherald\.com, insideseoul\.app\nLis les pages\.$/);
  assert.match(composerConsigne(gabarit, { jour: TODAY }), /rien n'est connu/);
});

test('une salle écrite en latin par la billetterie prend son nom Naver, le reste ne bouge pas', async () => {
  // KSPO DOME, deux matins de suite, deux concerts écartés : la table sait
  // ce que la consigne n'obtient pas.
  assert.equal(lieuEnCoréen('KSPO DOME'), 'KSPO돔');
  assert.equal(lieuEnCoréen('kspo dome (Olympic Park)'), 'KSPO돔');
  assert.equal(lieuEnCoréen('Gocheok Sky Dome'), '고척스카이돔');
  assert.equal(lieuEnCoréen('더현대 서울'), '더현대 서울');
  assert.equal(lieuEnCoréen('Musinsa Square'), 'Musinsa Square');

  const tri = await trierPistes(
    [{ ...PISTE, name: 'Concert TXT', kind: 'concert', theme: 'kpop', venue: 'KSPO DOME' }],
    { domaines: DOMAINES, connus: [], today: TODAY, fetcher }
  );
  assert.deepEqual(tri.retenues.map((e) => e.venue), ['KSPO돔']);
});

test('deux volets qui tombent sur le même événement n\'en font qu\'un, le premier rendu', async () => {
  const pistes = [
    PISTE,
    // Même source : le même article, vu deux fois.
    { ...PISTE, name: 'Chiikawa débarque à Seongsu' },
    // Même lieu, mêmes dates, même thème, nom à moitié : le même pop-up, par une autre rédaction.
    { ...PISTE, name: 'Pop-up Chiikawa Seongsu', source_url: 'https://www.koreaherald.com/article/1' },
    // Même lieu, mêmes dates, autre thème et autre nom : un autre pop-up du même grand magasin, gardé.
    { ...PISTE, name: 'Sanrio à Musinsa', theme: 'mode', source_url: 'https://www.koreaherald.com/article/2' },
  ];
  const tri = await trierPistes(pistes, { domaines: DOMAINES, connus: [], today: TODAY, fetcher });
  assert.deepEqual(tri.retenues.map((e) => e.name), ['Pop-up Chiikawa à Seongsu', 'Sanrio à Musinsa']);
  assert.deepEqual(
    tri.écartées.map(({ event, raison }) => `${event.name} : ${raison.replace(/nom à \d\.\d\d/, 'nom à N')}`),
    [
      'Chiikawa débarque à Seongsu : doublon du matin (même source) : « Pop-up Chiikawa à Seongsu »',
      'Pop-up Chiikawa Seongsu : doublon du matin (même thème, nom à N) : « Pop-up Chiikawa à Seongsu »',
    ]
  );
});

test('le tableau se lit malgré une phrase avant et une clôture de code autour', () => {
  const réponse = 'Voici ce que j\'ai trouvé :\n```json\n[{"name": "A"}, 3, null, {"name": "B"}]\n```\nBonne journée.';
  assert.deepEqual(extraireTableau(réponse), [{ name: 'A' }, { name: 'B' }]);
  assert.deepEqual(extraireTableau('[]'), []);
});

test('une réponse sans tableau, ou illisible, est une panne et non une liste vide', () => {
  assert.throws(() => extraireTableau('Je n\'ai rien trouvé.'), /aucun tableau/);
  assert.throws(() => extraireTableau('[{"name": "A",}]'), /illisible/);
  // Un tableau enveloppé dans un objet se lit quand même : c'est le tableau qu'on cherche.
  assert.deepEqual(extraireTableau('{"events": [{"name": "A"}]}'), [{ name: 'A' }]);
});

test('épurer ne garde que les champs du schéma, épurés, et retire les vides', () => {
  const propre = épurer({ ...PISTE, name: '  Pop-up  ', note: 'trouvé sur popga', confidence: 0.9, booking_url: '', map_url: null });
  assert.equal(propre.name, 'Pop-up');
  assert.ok(!('note' in propre) && !('confidence' in propre) && !('booking_url' in propre) && !('map_url' in propre));
});

test('résoudre suit la redirection et rend l\'adresse d\'arrivée, ou l\'adresse d\'origine si rien ne répond', async () => {
  assert.equal(
    await résoudre('https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', { fetcher }),
    'https://www.inven.co.kr/webzine/news/?news=300002'
  );
  const muet = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await résoudre('https://a.example/x', { fetcher: muet }), 'https://a.example/x');
});

test('une piste passe le tri même de l\'ingestion : ce qui atteint l\'agent serait retenu', async () => {
  const pistes = [
    PISTE,
    // Derrière une adresse de renvoi Google : jugée sur la page d'arrivée, Inven.
    { ...PISTE, name: 'Pop-up Sanrio à Hongdae', source_url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' },
    { ...PISTE, name: 'Vu chez popga', source_url: 'https://popga.co.kr/e/1' },
    { ...PISTE, name: 'Déjà fini', end_date: '2026-09-10' },
    { ...PISTE, name: 'Sans hangul', venue: 'Musinsa Square' },
    { ...PISTE, name: 'Sans source', source_url: undefined },
    { ...PISTE, name: 'Pop-up Chiikawa à Seongsu', note: 'un champ de trop' },
  ];
  const connus = [{ name: 'Pop-up Chiikawa à Seongsu', theme: 'personnages', start_date: '2026-09-18', end_date: '2026-09-28', venue: '무신사 스퀘어 성수' }];
  const tri = await trierPistes(pistes, { domaines: DOMAINES, connus, today: TODAY, fetcher });

  assert.deepEqual(tri.retenues.map((e) => e.name), ['Pop-up Sanrio à Hongdae']);
  assert.equal(tri.retenues[0].source_url, 'https://www.inven.co.kr/webzine/news/?news=300002');
  assert.ok(!('link_checked_at' in tri.retenues[0]), 'link_checked_at n\'est pas un champ du schéma');

  // Même nom que l'onglet, dates nouvelles : une prolongation, deux fois ici
  // parce que la première piste et la dernière portent le même nom.
  assert.equal(tri.prolongées.length, 2);
  assert.equal(tri.prolongées[0].connu.name, 'Pop-up Chiikawa à Seongsu');
  assert.ok(!('note' in tri.prolongées[1].event));

  const raisons = Object.fromEntries(tri.écartées.map(({ event, raison }) => [event.name, raison]));
  assert.match(raisons['Vu chez popga'], /domaine inconnu : popga\.co\.kr/);
  assert.match(raisons['Déjà fini'], /terminé le 2026-09-10/);
  assert.match(raisons['Sans hangul'], /sans hangul/);
  assert.equal(raisons['Sans source'], 'sans adresse source');
});

test('une piste connue de l’onglet sous un autre nom, au même lieu, est écartée avant l’agent', async () => {
  // C'est ici que le doublon coûte le moins : Gemini nomme rarement un pop-up
  // dans les mots de la rédaction qui l'a fait entrer dans l'onglet.
  const connus = [{ name: 'Chiikawa Pop-up Store Seongsu', theme: 'personnages', start_date: '2026-09-18', end_date: '2026-10-05', venue: '무신사스퀘어 성수' }];
  const tri = await trierPistes([PISTE], { domaines: DOMAINES, connus, today: TODAY, fetcher });
  assert.equal(tri.retenues.length, 0);
  assert.match(tri.écartées[0].raison, /déjà connu par le lieu/);
});

test('au plus trois pistes par domaine, dans l\'ordre de Gemini, le reste écarté et nommé', async () => {
  const { MAX_PAR_SOURCE } = await import('../scripts/lib/recherche.mjs');
  // Chacune à son étage : au même lieu, aux mêmes dates, elles seraient des
  // doublons du matin avant d'atteindre le plafond.
  const pistes = [
    ...[1, 2, 3, 4, 5].map((i) => ({ ...PISTE, name: `Inside ${i}`, venue: `더현대 서울 ${i}층`, source_url: `https://insideseoul.app/popups/${i}` })),
    { ...PISTE, name: 'Inven 1' },
  ];
  const tri = await trierPistes(pistes, { domaines: DOMAINES, connus: [], today: TODAY, fetcher });
  assert.equal(MAX_PAR_SOURCE, 3);
  assert.deepEqual(tri.retenues.map((e) => e.name), ['Inside 1', 'Inside 2', 'Inside 3', 'Inven 1']);
  assert.deepEqual(
    tri.écartées.map(({ event, raison }) => `${event.name} : ${raison}`),
    ['Inside 4 : 4e de insideseoul.app ce matin, 3 par source', 'Inside 5 : 5e de insideseoul.app ce matin, 3 par source']
  );
});

test('la section rend chaque piste retenue en JSON recopiable, nomme les écartées, et dit une panne', () => {
  const md = rendrePistes({
    retenues: [PISTE],
    prolongées: [{ event: { ...PISTE, name: 'Chiikawa pop-up Seongsu', end_date: '2026-10-12' }, connu: { name: 'Pop-up Chiikawa à Seongsu', start_date: '2026-09-18', end_date: '2026-10-05' } }],
    écartées: [{ event: { name: 'Vu chez popga', source_url: 'https://popga.co.kr/e/1' }, raison: 'domaine inconnu : popga.co.kr' }],
  });
  assert.match(md, /^## Pistes événements/);
  assert.match(md, /### Pop-up Chiikawa à Seongsu · personnages · 2026-09-18 → 2026-10-05\n\n```json\n\{/);
  assert.deepEqual(JSON.parse(md.match(/```json\n([\s\S]*?)```/)[1]), PISTE);
  // La prolongation est rendue sous le nom CONNU : c'est lui que l'ingestion reconnaîtra.
  assert.match(md, /dates nouvelles 2026-09-18 → 2026-10-12/);
  assert.match(md, /"name": "Pop-up Chiikawa à Seongsu",\n\s+"kind"[\s\S]*"end_date": "2026-10-12"/);
  assert.match(md, /- Vu chez popga \(popga\.co\.kr\) : domaine inconnu/);

  assert.match(rendrePistes({ panne: 'commande introuvable : gemini' }), /n'a rien donné \(commande introuvable : gemini\)\. Cherche toi-même/);
  assert.match(rendrePistes({}), /Aucune piste retenue ce matin/);
});

// --- Le script, de bout en bout, avec un faux Gemini ----------------------------

test('le script complète la veille avec ce qu\'un faux Gemini répond, et dit une panne quand il n\'y a pas de Gemini', async (t) => {
  // Dans veille/, ignoré par git, et non dans le dossier temporaire du
  // système : selon l'environnement, os.tmpdir() a déjà rendu un chemin
  // relatif, et le dossier atterrissait à la racine du dépôt. Sur un clone
  // frais, celui de la CI, veille/ n'existe pas encore.
  await mkdir(path.join(RACINE, 'veille'), { recursive: true });
  const dossier = await mkdtemp(path.join(RACINE, 'veille', 'test-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const veille = path.join(dossier, `${TODAY}.md`);
  await writeFile(veille, '# Veille de test\n');

  // Le faux répond la forme exacte de `gemini --output-format json`, et lit
  // sa consigne ($2, après -p) pour répondre en volet « pages » ou en volet
  // « coréen » : les deux sessions du matin, et la fusion de leurs pistes.
  // Chaque piste vise une adresse qui ne répond pas ici, et sera donc
  // écartée par la sonde : le test ne dépend pas du réseau, et vérifie que
  // le tri a eu lieu.
  const faux = path.join(dossier, 'faux-gemini.sh');
  const piste = (nom) =>
    `[{\\"name\\": \\"${nom}\\", \\"kind\\": \\"popup\\", \\"theme\\": \\"food\\", \\"venue\\": \\"성수\\", \\"area\\": \\"Seongsu\\", \\"start_date\\": \\"2026-09-20\\", \\"end_date\\": \\"2026-09-21\\", \\"summary\\": \\"Test.\\", \\"source_name\\": \\"Inven\\", \\"source_url\\": \\"https://www.inven.co.kr.invalid/${nom.replaceAll(' ', '-')}\\", \\"source_lang\\": \\"ko\\"}]`;
  await writeFile(
    faux,
    `#!/bin/sh\ncase "$2" in *"pages qui listent"*) printf '%s' '{"status": "SUCCESS", "num_turns": 7, "response": "${piste('Pop-up pages')}"}' ;; *) printf '%s' '{"status": "SUCCESS", "num_turns": 9, "response": "${piste('Pop-up coréen')}"}' ;; esac\n`,
    { mode: 0o755 }
  );

  const env = { ...process.env, MATINALE_GEMINI: faux, SITE_URL: 'http://127.0.0.1:9' };
  const { stdout } = await exécuter('node', ['scripts/recherche.mjs', '--jour', TODAY, '--dossier', dossier], { cwd: RACINE, env });
  assert.match(stdout, /✓ Gemini pages\s+1 pistes en \d+ s, 7 tours/);
  assert.match(stdout, /✓ Gemini coréen\s+1 pistes en \d+ s, 9 tours/);
  assert.match(stdout, /! Pop-up pages : (source morte|domaine inconnu)/);
  assert.match(stdout, /! Pop-up coréen : (source morte|domaine inconnu)/);
  const md = await readFile(veille, 'utf8');
  assert.match(md, /^# Veille de test\n\n## Pistes événements\n/);
  assert.match(md, /Aucune piste retenue ce matin/);
  assert.match(md, /- Pop-up pages \(inven\.co\.kr\.invalid\) : /);
  assert.match(md, /- Pop-up coréen \(inven\.co\.kr\.invalid\) : /);

  // Un volet en panne est un volet en moins : l'autre suffit à la matinée,
  // le journal nomme celui qui manque, le code de sortie reste bon.
  await writeFile(veille, '# Veille de test\n');
  await writeFile(
    faux,
    `#!/bin/sh\ncase "$2" in *"pages qui listent"*) printf '%s' '{"status": "SUCCESS", "num_turns": 7, "response": "${piste('Pop-up pages')}"}' ;; *) printf '%s' '{"status": "ERROR", "error": "quota"}' ;; esac\n`,
    { mode: 0o755 }
  );
  const moitié = await exécuter('node', ['scripts/recherche.mjs', '--jour', TODAY, '--dossier', dossier], { cwd: RACINE, env });
  assert.match(moitié.stdout, /✓ Gemini pages\s+1 pistes/);
  assert.match(moitié.stdout, /! Gemini coréen\s+Gemini : ERROR, quota/);
  assert.match(await readFile(veille, 'utf8'), /- Pop-up pages \(inven\.co\.kr\.invalid\) : /);

  // Permission refusée : la session rend SUCCESS et une réponse vide, c'est
  // `denied_actions` qui le dit, et le journal doit nommer le réglage.
  await writeFile(veille, '# Veille de test\n');
  await writeFile(faux, `#!/bin/sh\nprintf '%s' '{"status": "SUCCESS", "response": "", "denied_actions": [{"action": "read_url", "display_name": "ReadUrlContent"}]}'\n`, { mode: 0o755 });
  await assert.rejects(
    exécuter('node', ['scripts/recherche.mjs', '--jour', TODAY, '--dossier', dossier], { cwd: RACINE, env }),
    ({ code, stdout }) => code === 1 && /! Gemini pages\s+permission refusée : read_url\. Ajouter « read_url\(\*\) »/.test(stdout)
  );
  // La même panne des deux côtés se dit une fois.
  assert.match(await readFile(veille, 'utf8'), /n'a rien donné \(permission refusée : read_url/);

  // Pas de Gemini : le code de sortie le dit au lanceur, la veille le dit à l'agent.
  await writeFile(veille, '# Veille de test\n');
  await assert.rejects(
    exécuter('node', ['scripts/recherche.mjs', '--jour', TODAY, '--dossier', dossier], {
      cwd: RACINE,
      env: { ...env, MATINALE_GEMINI: path.join(dossier, 'absent') },
    }),
    ({ code, stdout }) => code === 1 && /! Gemini pages\s+commande introuvable/.test(stdout)
  );
  assert.match(await readFile(veille, 'utf8'), /La recherche du matin n'a rien donné \(commande introuvable/);
});

// --- Ce qui tient les pièces ensemble -------------------------------------------

test('la recherche ne contourne jamais les permissions : ce sont elles qui la rendent lançable sans personne', async () => {
  // En headless, Antigravity CLI refuse en silence ce que les réglages du
  // serveur n'autorisent pas. C'est le mécanisme qui interdit à une recherche
  // d'écrire dans le dépôt ; un drapeau qui le lève ici le rendrait vain.
  const code = (await lire('scripts/recherche.mjs')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/dangerously-skip-permissions|--yolo|approval-mode/.test(code), 'le script lève les permissions');
});

test('la consigne de Gemini demande la forme même du schéma, et nomme chaque thème', async () => {
  const consigne = await lire('prompts/recherche-evenements.md');
  const { THEMES, KINDS } = await import('../shared/evenements.mjs');
  for (const theme of THEMES) assert.ok(consigne.includes(`\`${theme}\``), `thème « ${theme} » absent`);
  for (const kind of KINDS) assert.ok(consigne.includes(`\`${kind}\``), `kind « ${kind} » absent`);
  for (const gabarit of ['{{JOUR}}', '{{CONNUS}}', '{{DOMAINES}}', '{{METHODE}}']) assert.ok(consigne.includes(gabarit), `${gabarit} absent`);

  // Deux volets, deux méthodes, et chacune sait que l'autre existe : sans
  // cela, la session « coréen » relirait les pages qui listent, et le second
  // budget serait le premier, dépensé deux fois.
  const méthodes = Object.fromEntries(await Promise.all(VOLETS.map(async (v) => [v.nom, await lire(v.méthode)])));
  assert.deepEqual(Object.keys(méthodes), ['pages', 'coréen']);
  for (const page of ['insideseoul.app/popups', 'world.nol.com', 'kpopofficial.com', 'festival.seoul.go.kr']) {
    assert.ok(méthodes.pages.includes(page), `page « ${page} » absente du volet pages`);
  }
  assert.match(méthodes.pages, /ne fais pas de recherche par thème/i);
  assert.match(méthodes.coréen, /ne lis aucune page qui liste/i);
  for (const theme of THEMES) assert.ok(méthodes.coréen.includes(`\`${theme}\``), `thème « ${theme} » absent du volet coréen`);

  // L'exemple de la consigne, tel quel, passerait le schéma d'un brief : ce
  // que Gemini recopie doit être ce que l'ingestion accepte.
  const { validateSchema } = await import('../scripts/lib/guards.mjs');
  const schéma = JSON.parse(await lire('schemas/brief.schema.json'));
  const exemple = JSON.parse(await lire('tests/fixtures/brief-avec-evenements.json'));
  // `\r?` : la copie de travail d'un poste Windows porte des CRLF, comme
  // dans prompt.test.mjs ; sans lui, ce test échoue chez le mainteneur.
  const bloc = consigne.match(/```\r?\n(\[[\s\S]*?\])\r?\n```/);
  assert.ok(bloc, 'aucun exemple de tableau dans la consigne');
  assert.deepEqual(validateSchema({ ...exemple, events: JSON.parse(bloc[1]) }, schéma), []);
});

test('le lanceur et le prompt de l\'agent connaissent la recherche', async () => {
  const lanceur = await lire('bin/brief-du-jour.sh');
  const prompt = await lire('prompts/brief-quotidien.md');
  assert.ok(lanceur.includes('scripts/recherche.mjs'), 'le lanceur ne lance pas la recherche');
  assert.ok(lanceur.indexOf('scripts/veille.mjs') < lanceur.indexOf('scripts/recherche.mjs'), 'la recherche complète la veille : elle vient après');
  assert.ok(prompt.includes('Pistes événements'), 'le prompt ne fait pas lire les pistes');
});
