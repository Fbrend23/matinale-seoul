// La veille actualité, testée sans réseau et sans Gemini.
//
// Ce qui peut mentir en silence ici : une piste qui atteindrait l'agent sans
// avoir été sondée, il la tiendrait pour vue ; une adresse déjà dans les flux
// qui reviendrait sous un autre habit (`?utm_source=rss`) ; un terrain nommé
// à Gemini dont l'allowlist ne veut pas, et il chercherait pour rien. Le
// reste est de l'analyse de texte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import {
  VOLETS_ACTUALITE, MAX_PAR_SECTION, MAX_PAR_SOURCE, SEUIL_MÊME_HISTOIRE,
  composerConsigneActualité, épurerPiste, cléAdresse, lireVeille, trierPistesActualité, rendrePistesActualité,
} from '../scripts/lib/actualite.mjs';
import { checkAllowlist, similarity } from '../scripts/lib/guards.mjs';
import { SECTIONS } from '../shared/sections.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');
const exécuter = promisify(execFile);

const JOUR = '2026-09-18';
const DOMAINES = ['chosun.com', 'koreaherald.com', 'yna.co.kr', 'inven.co.kr'];

const VEILLE = `# Veille du 2026-09-18 (heure de Séoul), relevée le 2026-09-18T07:30:00+09:00

## Déjà couvert par le site (quatorze derniers briefs)

- 2026-09-17 · coree · La contestation sociale gagne la sidérurgie coréenne
- 2026-09-16 · tech · Google ouvre la maison connectée aux agents IA

## Déjà dans l'onglet événements

- 2026-09-05 → 2026-10-12 · pokemon · Pop-up Pokémon Center · 포켓몬센터 성수

## Titres parus depuis 30 heures

### Korea Herald (en) · coree, tourisme · 2 titres

- 2026-09-18T07:00:00+09:00 · Seoul stocks end almost flat as investors weigh Fed's first rate hike in 3 yrs
  https://www.koreaherald.com/article/10877452?utm_source=rss
  L'indice composite a clôturé quasiment stable.
- 2026-09-17T15:37:23+09:00 · Will Nodeul Island become Seoul's next landmark?
  https://www.koreaherald.com/article/10877330

### Yonhap (ko) · coree · 1 titre

- 2026-09-18T06:40:00+09:00 · 김여정, 美주도 훈련에 반발해 강력 대응 시사…"적대성 신기록"
  https://www.yna.co.kr/view/AKR20260918001

## Pistes événements

### Pop-up · anime · 2026-09-18 → 2026-09-27
`;

// Des titres qui ne se ressemblent pas entre eux : le tri compare les titres
// des pistes deux à deux, et « Titre 1 » contre « Titre 2 » passerait pour la
// même histoire. Chaque adresse tire un titre différent d'une liste.
const TITRES = [
  ['Incheon bat son record de passagers', '인천공항 역대 최다 여객'],
  ['Le won recule face au dollar', '원달러 환율 상승 마감'],
  ['Nexon annonce un nouveau MMORPG', '넥슨 신작 MMORPG 공개'],
  ['Séoul ouvre un pont piéton sur le Han', '한강 보행교 개통'],
  ['La KBO fixe son calendrier des séries', 'KBO 포스트시즌 일정 확정'],
  ['Samsung lance une mémoire HBM4', '삼성전자 HBM4 양산'],
  ['Le typhon frôle Jeju', '태풍 제주 근접'],
  ['Kakao ferme un service de messagerie', '카카오 서비스 종료'],
  ['Le musée national prolonge une exposition', '국립박물관 전시 연장'],
  ['Hanwha remporte le derby de Daejeon', '한화 대전 더비 승리'],
  ['Le K-ETA reste suspendu pour 2027', 'K-ETA 면제 2027년 연장'],
  ['Naver dévoile un modèle de langue', '네이버 언어모델 공개'],
];
let compteur = 0;
const piste = (section, url, extra = {}) => ({
  section,
  headline: TITRES[compteur % TITRES.length][0],
  original_headline: TITRES[compteur++ % TITRES.length][1],
  summary: 'Deux phrases.',
  source_name: 'Chosun',
  source_url: url,
  source_lang: 'ko',
  published_at: '2026-09-18T08:00:00+09:00',
  ...extra,
});

const vivant = async () => ({ ok: true, status: 200 });

test('chaque volet couvre une rubrique, une fois, et ne nomme à Gemini que des domaines de l\'allowlist', async () => {
  assert.deepEqual(VOLETS_ACTUALITE.map((v) => v.section), SECTIONS);
  const { domains } = JSON.parse(await lire('config/sources.json'));
  for (const volet of VOLETS_ACTUALITE) {
    const nommés = volet.terrain.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [];
    assert.ok(nommés.length >= 3, `${volet.section} : le terrain ne nomme pas de domaine`);
    const inconnus = checkAllowlist(nommés.map((d) => ({ source_url: `https://${d}/` })), domains);
    assert.deepEqual(inconnus.map((i) => i.host), [], `${volet.section} : terrain hors allowlist`);
    assert.ok(/[가-힣]/.test(volet.requêtes), `${volet.section} : pas de requête en coréen`);
  }
});

test('la consigne reçoit le jour, la rubrique, son terrain, l\'allowlist et ce qui est déjà connu', async () => {
  const gabarit = await lire('prompts/actualite-presse.md');
  for (const g of ['{{JOUR}}', '{{SECTION}}', '{{DESCRIPTION}}', '{{TERRAIN}}', '{{REQUETES}}', '{{DOMAINES}}', '{{DEJA}}']) {
    assert.ok(gabarit.includes(g), `${g} absent du gabarit`);
  }
  const consigne = composerConsigneActualité(gabarit, { jour: JOUR, volet: VOLETS_ACTUALITE[0], domaines: DOMAINES, déjà: ['Un titre', 'Un autre'] });
  assert.ok(!/\{\{[A-Z]+\}\}/.test(consigne), 'un gabarit est resté');
  assert.match(consigne, /rubrique `tourisme`/);
  assert.match(consigne, /chosun\.com, koreaherald\.com, yna\.co\.kr, inven\.co\.kr/);
  assert.match(consigne, /- Un titre\n- Un autre/);
  assert.match(consigne, /Ne reconstruis jamais une adresse/);
  assert.match(consigne, /ne cherche pas chez eux/);
  assert.match(composerConsigneActualité(gabarit, { jour: JOUR, volet: VOLETS_ACTUALITE[1] }), /la veille est vide pour cette rubrique/);
});

test('une piste est réduite à ses champs, et rangée dans la rubrique du volet qui l\'a rendue', () => {
  const propre = épurerPiste({ section: 'tech', headline: ' T ', source_url: 'https://x/y', note: 'à jeter', confidence: 0.9, published_at: '' }, 'coree');
  assert.deepEqual(propre, { section: 'coree', headline: 'T', source_url: 'https://x/y' });
  // L'heure : à la forme des flux, à l'heure de Séoul ; une date seule saute.
  assert.equal(épurerPiste({ published_at: '2026-09-17T07:12:43.226Z' }, 'tech').published_at, '2026-09-17T16:12:43+09:00');
  assert.equal(épurerPiste({ published_at: '2026-09-18T09:05:00+09:00' }, 'tech').published_at, '2026-09-18T09:05:00+09:00');
  assert.ok(!('published_at' in épurerPiste({ published_at: '2026-09-17' }, 'tech')));
  assert.ok(!('published_at' in épurerPiste({ published_at: 'hier' }, 'tech')));
});

test('une adresse se reconnaît malgré utm, ancre, barre finale et www', () => {
  assert.equal(cléAdresse('https://www.koreaherald.com/article/10877452?utm_source=rss#top'), 'koreaherald.com/article/10877452');
  assert.equal(cléAdresse('https://koreaherald.com/article/10877452/'), 'koreaherald.com/article/10877452');
  assert.equal(cléAdresse('https://www.inven.co.kr/webzine/news/?news=1&utm_campaign=x'), 'inven.co.kr/webzine/news?news=1');
  assert.equal(cléAdresse('pas une adresse'), 'pas une adresse');
});

test('la veille se lit : adresses des flux, titres par rubrique, titres publiés par le site', () => {
  const v = lireVeille(VEILLE);
  assert.deepEqual([...v.adresses], ['koreaherald.com/article/10877452', 'koreaherald.com/article/10877330', 'yna.co.kr/view/AKR20260918001']);
  assert.equal(v.titres.get('coree').length, 3, 'Korea Herald vaut pour coree et tourisme, Yonhap pour coree');
  assert.equal(v.titres.get('tourisme').length, 2);
  assert.equal(v.titres.get('tech').length, 0);
  assert.deepEqual(v.publiés, ['La contestation sociale gagne la sidérurgie coréenne', 'Google ouvre la maison connectée aux agents IA']);
  // Une veille vide : rien n'est connu, rien ne casse.
  const vide = lireVeille('');
  assert.equal(vide.adresses.size, 0);
  assert.deepEqual(vide.publiés, []);
});

test('le tri écarte ce qui est déjà dans les flux, hors allowlist, mort, ou déjà publié, et garde un accès refusé', async () => {
  const veille = lireVeille(VEILLE);
  const pistes = [
    piste('coree', 'https://www.chosun.com/a/100001'),
    // La même page qu'un flux, sans le paramètre utm : déjà dans la veille.
    piste('coree', 'https://www.koreaherald.com/article/10877452'),
    piste('coree', 'https://news.naver.com/article/100002', { source_name: 'Naver' }),
    piste('coree', 'https://www.chosun.com/a/100003-mort'),
    piste('coree', 'https://www.chosun.com/a/100004-refuse'),
    // Le titre français d'une histoire que le site a publiée.
    piste('coree', 'https://www.chosun.com/a/100005', { headline: 'La contestation sociale gagne la sidérurgie coréenne' }),
    // Le titre original d'une dépêche que les flux portent déjà, chez une autre rédaction.
    piste('coree', 'https://www.chosun.com/a/100006', { original_headline: '김여정, 美주도 다국적 훈련 반발…“가용 수단 총동원 대응”' }),
    piste('coree', 'http://www.chosun.com/a/100007'),
    { section: 'coree', source_url: 'https://www.chosun.com/a/100008' },
  ];
  const fetcher = async (url) => {
    if (url.endsWith('-mort')) return { ok: false, status: 404 };
    if (url.endsWith('-refuse')) return { ok: false, status: 403 };
    return { ok: true, status: 200 };
  };
  const { retenues, écartées } = await trierPistesActualité(pistes, { domaines: DOMAINES, veille, fetcher });
  assert.deepEqual(retenues.map((p) => p.source_url), ['https://www.chosun.com/a/100001', 'https://www.chosun.com/a/100004-refuse']);
  assert.equal(retenues[1].accès, 'refusé');
  const raisons = Object.fromEntries(écartées.map(({ piste: p, raison }) => [p.source_url, raison]));
  assert.match(raisons['https://www.koreaherald.com/article/10877452'], /déjà dans les flux/);
  assert.match(raisons['https://news.naver.com/article/100002'], /hors allowlist : news\.naver\.com/);
  assert.match(raisons['https://www.chosun.com/a/100003-mort'], /source morte \(HTTP 404\)/);
  assert.match(raisons['https://www.chosun.com/a/100005'], /déjà publiée par le site/);
  assert.match(raisons['https://www.chosun.com/a/100006'], /même histoire dans les flux : « 김여정/);
  assert.match(raisons['http://www.chosun.com/a/100007'], /sans adresse source en https/);
  assert.match(raisons['https://www.chosun.com/a/100008'], /sans titre/);
});

test('le seuil de même histoire sépare deux titres d\'une même dépêche de deux titres sans rapport', () => {
  // Les deux couples mesurés sur la veille du 18 septembre 2026, qui ont fixé le seuil.
  const même = similarity('김여정, 美주도 훈련에 반발해 강력 대응 시사…"적대성 신기록"', '김여정, 美주도 다국적 훈련 반발…“가용 수단 총동원 대응”');
  const autre = similarity('3 rescued, 1 missing after N. Korean vessel sinks', '(Asiad) N. Korean sports minister arrives in Japan');
  assert.ok(même >= SEUIL_MÊME_HISTOIRE, `même dépêche à ${même.toFixed(2)}`);
  assert.ok(autre < SEUIL_MÊME_HISTOIRE, `sans rapport à ${autre.toFixed(2)}`);
});

test('deux pistes sur la même histoire n\'en font qu\'une, et les plafonds tiennent par rubrique et par source', async () => {
  const veille = lireVeille('');
  const pistes = [
    piste('tech', 'https://www.chosun.com/a/1', { original_headline: '삼성전자, 3나노 2세대 양산 시작' }),
    piste('tech', 'https://www.chosun.com/a/2', { original_headline: '삼성전자 3나노 2세대 공정 양산 시작' }),
    ...Array.from({ length: MAX_PAR_SECTION + 2 }, (_, i) => piste('sport', `https://www.yna.co.kr/s/${i}`, { source_name: i < 4 ? 'Yonhap' : 'Chosun', source_url: i < 4 ? `https://www.yna.co.kr/s/${i}` : `https://www.chosun.com/s/${i}` })),
  ];
  const { retenues, écartées } = await trierPistesActualité(pistes, { domaines: DOMAINES, veille, fetcher: vivant });
  assert.equal(retenues.filter((p) => p.section === 'tech').length, 1);
  assert.match(écartées.find(({ piste: p }) => p.source_url === 'https://www.chosun.com/a/2').raison, /même histoire qu'une autre piste/);
  const sport = retenues.filter((p) => p.section === 'sport');
  assert.equal(sport.filter((p) => p.source_url.includes('yna.co.kr')).length, MAX_PAR_SOURCE, 'la quatrième de Yonhap est écartée');
  assert.ok(sport.length <= MAX_PAR_SECTION);
  assert.ok(écartées.some(({ raison }) => /4e de yna\.co\.kr pour cette rubrique/.test(raison)));
});

test('la section rendue a la forme des flux, nomme les rubriques non cherchées, et dit les écartées', () => {
  const md = rendrePistesActualité({
    retenues: [
      piste('tourisme', 'https://www.chosun.com/a/1', { headline: 'Incheon bat son record', original_headline: '인천공항 역대 최다', summary: 'Deux phrases.' }),
      piste('coree', 'https://www.chosun.com/a/2', { headline: 'Sans heure', original_headline: 'Sans heure', published_at: undefined, accès: 'refusé' }),
    ],
    écartées: [{ piste: piste('tech', 'https://news.naver.com/a/3'), raison: 'domaine hors allowlist : news.naver.com' }],
    pannes: [{ section: 'sport', panne: 'Gemini : ERROR, quota' }],
  });
  assert.match(md, /^## Pistes actualité\n/);
  assert.match(md, /### tourisme · 1 piste\n\n- 2026-09-18T08:00:00\+09:00 · 인천공항 역대 최다 \(Chosun, ko\)\n  https:\/\/www\.chosun\.com\/a\/1\n  Incheon bat son record — Deux phrases\./);
  assert.match(md, /### coree · 1 piste\n\n- heure non donnée · Sans heure \(Chosun, ko\)\n  https:\/\/www\.chosun\.com\/a\/2\n  Deux phrases\. — accès refusé à la sonde/);
  assert.match(md, /### tech · 0 piste\n/);
  assert.match(md, /### sport · non cherchée \(Gemini : ERROR, quota\)/);
  assert.match(md, /Écartées au tri, ne les recherche pas :\n\n- tech · .* \(news\.naver\.com\) : domaine hors allowlist/);
  // Les cinq en panne : une seule phrase, et l'agent sait qu'il n'a que les flux.
  const toutEnPanne = rendrePistesActualité({ pannes: SECTIONS.map((section) => ({ section, panne: 'commande introuvable : agy' })) });
  assert.match(toutEnPanne, /n'a rien donné \(commande introuvable : agy\)\. Les flux ci-dessus sont tout ce qu'il y a\./);
  assert.ok(!toutEnPanne.includes('###'));
});

// --- Le script, de bout en bout, avec un faux Gemini ----------------------------

test('le script lit la veille, interroge un volet par rubrique, trie, et ajoute la section à la veille', async (t) => {
  await mkdir(path.join(RACINE, 'veille'), { recursive: true });
  const dossier = await mkdtemp(path.join(RACINE, 'veille', 'test-actualite-'));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  await writeFile(path.join(dossier, `${JOUR}.md`), VEILLE);

  // Le faux répond la forme exacte de `agy --output-format json`, et lit la
  // rubrique dans sa consigne pour rendre une piste à son nom. Les adresses
  // visent un site muet : la sonde les dira mortes, et c'est le chemin qu'on
  // vérifie, lecture, cinq sessions, tri, écriture, pas le réseau.
  const faux = path.join(dossier, 'faux-agy.sh');
  await writeFile(
    faux,
    `#!/bin/sh
section=$(printf '%s' "$2" | sed -n 's/.*rubrique \`\\([a-z]*\\)\`.*/\\1/p' | head -1)
printf '{"status":"SUCCESS","num_turns":3,"duration_seconds":8,"response":"[{\\"section\\":\\"%s\\",\\"headline\\":\\"Piste %s\\",\\"original_headline\\":\\"원문 %s\\",\\"source_name\\":\\"Chosun\\",\\"source_url\\":\\"http://127.0.0.1:9/%s\\",\\"source_lang\\":\\"ko\\"}]"}' "$section" "$section" "$section" "$section"
`,
    { mode: 0o755 }
  );
  const env = { ...process.env, MATINALE_GEMINI: faux };
  const { stdout } = await exécuter('node', ['scripts/actualite.mjs', '--jour', JOUR, '--dossier', dossier], { cwd: RACINE, env }).catch((e) => e);
  assert.match(stdout, /✓ veille\s+3 adresses déjà relevées, 2 titres publiés/);
  for (const section of SECTIONS) assert.match(stdout, new RegExp(`✓ Gemini ${section}\\s+1 pistes en \\d+ s, 3 tours`));
  assert.match(stdout, /! tourisme · Piste tourisme : sans adresse source en https/);
  assert.match(stdout, /pistes actualité écrites : .*2026-09-18\.md \(0 retenues, 5 écartées, 0 rubrique\(s\) non cherchée\(s\)\)/);
  const md = await readFile(path.join(dossier, `${JOUR}.md`), 'utf8');
  assert.ok(md.startsWith('# Veille du 2026-09-18'), 'la veille est complétée, pas remplacée');
  assert.match(md, /\n## Pistes actualité\n/);
  assert.match(md, /### tourisme · 0 piste/);

  // Sans agy : les cinq en panne, la section le dit, et le code de sortie aussi.
  await writeFile(path.join(dossier, `2026-09-19.md`), VEILLE.replace('2026-09-18', '2026-09-19'));
  await assert.rejects(
    exécuter('node', ['scripts/actualite.mjs', '--jour', '2026-09-19', '--dossier', dossier], { cwd: RACINE, env: { ...process.env, MATINALE_GEMINI: path.join(dossier, 'absent') } }),
    ({ code, stdout }) => code === 1 && /commande introuvable/.test(stdout)
  );
  assert.match(await readFile(path.join(dossier, '2026-09-19.md'), 'utf8'), /La veille de la presse coréenne n'a rien donné \(commande introuvable/);
});

test('le lanceur lance la veille actualité avant la session, en même temps que la recherche', async () => {
  const lanceur = await lire('bin/brief-du-jour.sh');
  assert.ok(lanceur.includes('scripts/actualite.mjs'), 'le lanceur ne lance pas la veille actualité');
  assert.ok(lanceur.indexOf('scripts/veille.mjs') < lanceur.indexOf('scripts/actualite.mjs'), 'après la veille RSS, qu\'elle complète');
  assert.ok(lanceur.indexOf('scripts/actualite.mjs') < lanceur.indexOf('claude -p'), 'avant la session, qui la lit');
  assert.match(lanceur, /scripts\/actualite\.mjs[^\n]*&\n/);
  assert.match(lanceur, /wait "\$PID_ACTU" \|\| echo/);
  const prompt = await lire('prompts/brief-quotidien.md');
  assert.ok(prompt.includes('pistes actualité'), 'le prompt ne dit pas à l\'agent que la section existe');
});
