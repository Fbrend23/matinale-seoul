// La veille, testée sans réseau.
//
// Deux façons de mentir en silence : proposer une adresse que l'allowlist
// refuserait, le brief entier partirait alors en brouillon sans que l'agent
// sache pourquoi ; et dater un article dans le mauvais fuseau, l'agent
// recopie `published_at` tel quel. Le reste est de l'analyse de texte, et se
// vérifie sur deux flux figés, un RSS 2.0, un Atom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { analyserFlux, récents, isoSéoul, releverVeille, rendreVeille } from '../scripts/lib/veille.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');

/** RSS 2.0 tel que Korea Herald et TechCrunch le servent : CDATA, entités, HTML dans la description. */
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>
<item><title><![CDATA[Myeong-dong holds lead as Korea&#8217;s tourist shopping hub]]></title>
<link>https://www.koreaherald.com/article/10871768</link>
<pubDate>Sun, 13 Sep 2026 18:42:17 +0900</pubDate>
<description><![CDATA[<p>Seoul&rsquo;s Jung-gu, home to Myeong-dong, captured nearly a quarter of &amp; more.</p>]]></description></item>
<item><title>Sans adresse</title><pubDate>Sun, 13 Sep 2026 18:00:00 +0900</pubDate></item>
<item><title>Sans date</title><link>https://www.koreaherald.com/article/1</link></item>
<item><title>Vieux</title><link>https://www.koreaherald.com/article/2</link><pubDate>Mon, 01 Sep 2026 08:00:00 +0900</pubDate></item>
</channel></rss>`;

/** Atom, tel que The Verge le sert : <link href>, <published>, <summary>. */
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title type="html">Lyft opens its app to Waymo robotaxis</title>
<link rel="alternate" type="text/html" href="https://www.theverge.com/news/1"/>
<published>2026-09-13T22:10:00+00:00</published><updated>2026-09-13T23:00:00+00:00</updated>
<summary type="html">&lt;p&gt;Nashville first.&lt;/p&gt;</summary></entry>
</feed>`;

const MAINTENANT = new Date('2026-09-13T22:30:00Z'); // 7 h 30 à Séoul, le 14

test('un flux RSS 2.0 donne titre, adresse, date et extrait, décodés', () => {
  const [e] = analyserFlux(RSS);
  assert.equal(e.title, 'Myeong-dong holds lead as Korea’s tourist shopping hub');
  assert.equal(e.url, 'https://www.koreaherald.com/article/10871768');
  assert.equal(e.date.toISOString(), '2026-09-13T09:42:17.000Z');
  assert.equal(e.extrait, 'Seoul’s Jung-gu, home to Myeong-dong, captured nearly a quarter of & more.');
});

test("une entrée sans adresse n'est pas proposée, une entrée sans date est gardée avec date nulle", () => {
  const titres = analyserFlux(RSS).map((e) => e.title);
  assert.ok(!titres.includes('Sans adresse'));
  assert.ok(titres.includes('Sans date'));
  assert.equal(analyserFlux(RSS).find((e) => e.title === 'Sans date').date, null);
});

test('un flux Atom se lit aussi : href, published, summary', () => {
  const [e] = analyserFlux(ATOM);
  assert.equal(e.url, 'https://www.theverge.com/news/1');
  assert.equal(e.date.toISOString(), '2026-09-13T22:10:00.000Z');
  assert.equal(e.extrait, 'Nashville first.');
});

test('récents() garde la fenêtre, écarte le vieux et le non daté, du plus récent au plus ancien', () => {
  const r = récents([...analyserFlux(RSS), ...analyserFlux(ATOM)], { maintenant: MAINTENANT, heures: 30 });
  assert.deepEqual(
    r.map((e) => e.title),
    ['Lyft opens its app to Waymo robotaxis', 'Myeong-dong holds lead as Korea’s tourist shopping hub']
  );
});

test("isoSéoul écrit l'heure de Séoul avec son décalage, la forme de published_at", () => {
  // 22:10 UTC, c'est 07:10 le lendemain à Séoul. Le test vaut identiquement
  // dans les deux passes de la CI, en UTC et à Séoul.
  assert.equal(isoSéoul(new Date('2026-09-13T22:10:00Z')), '2026-09-14T07:10:00+09:00');
  assert.equal(isoSéoul(new Date('2026-09-13T09:42:17+09:00')), '2026-09-13T09:42:17+09:00');
});

test('un flux en panne est un flux en moins, pas une veille en moins', async () => {
  const flux = [
    { source_name: 'A', lang: 'en', pour: ['tech'], url: 'https://a.example/feed' },
    { source_name: 'B', lang: 'en', pour: ['tech'], url: 'https://b.example/feed' },
    { source_name: 'C', lang: 'en', pour: ['tech'], url: 'https://c.example/feed' },
  ];
  const fetcher = async (url) => {
    if (url.startsWith('https://a')) return { ok: true, status: 200, text: async () => ATOM };
    if (url.startsWith('https://b')) return { ok: false, status: 503, text: async () => '' };
    throw new TypeError('fetch failed');
  };
  const veille = await releverVeille(flux, { fetcher, maintenant: MAINTENANT });
  assert.equal(veille.relevés[0].entrées.length, 1);
  assert.deepEqual(veille.pannes, ['B : HTTP 503', 'C : fetch failed']);

  const md = rendreVeille(veille, { jour: '2026-09-14', maintenant: MAINTENANT });
  assert.match(md, /^# Veille du 2026-09-14/);
  assert.match(md, /- 2026-09-14T07:10:00\+09:00 · Lyft opens its app to Waymo robotaxis\n {2}https:\/\/www\.theverge\.com\/news\/1/);
  assert.match(md, /B : HTTP 503 ; C : fetch failed/);
});

test("la veille dit quand le site n'a pas répondu, plutôt que de se taire", () => {
  const md = rendreVeille({ relevés: [], pannes: [] }, { jour: '2026-09-14', maintenant: MAINTENANT });
  assert.match(md, /récupère `\/api\/recent\.json` toi-même/);
  assert.match(md, /récupère `\/api\/evenements\.json` toi-même/);

  const avec = rendreVeille(
    { relevés: [], pannes: [] },
    {
      jour: '2026-09-14',
      maintenant: MAINTENANT,
      recent: { briefs: [{ date: '2026-09-13', headlines: [{ section: 'coree', headline: 'Un titre' }] }] },
      evenements: { events: [{ name: 'Pop-up', theme: 'anime', start_date: '2026-09-01', end_date: '2026-09-30', venue: '성수' }] },
    }
  );
  assert.match(avec, /- 2026-09-13 · coree · Un titre/);
  assert.match(avec, /- 2026-09-01 → 2026-09-30 · anime · Pop-up · 성수/);
});

// --- Le couple flux.json / sources.json ---------------------------------------

test("chaque flux relevé vient d'un domaine de l'allowlist", async () => {
  // Sans quoi la veille proposerait chaque matin des adresses qui retiendraient
  // le brief entier en brouillon, et l'agent, qui les tient pour « vues »,
  // n'aurait aucune raison de s'en méfier.
  const { flux } = JSON.parse(await lire('config/flux.json'));
  const { domains } = JSON.parse(await lire('config/sources.json'));
  assert.ok(flux.length > 0);
  for (const f of flux) {
    const hôte = new URL(f.url).hostname;
    const connu = domains.some((d) => hôte === d || hôte.endsWith(`.${d}`));
    assert.ok(connu, `${f.source_name} : ${hôte} n'est pas dans config/sources.json`);
    assert.ok(f.source_name && f.lang && Array.isArray(f.pour) && f.pour.length > 0, `${f.url} : champs manquants`);
  }
});

test("le prompt fait lire la veille là où le script l'écrit", async () => {
  const prompt = await lire('prompts/brief-quotidien.md');
  const script = await lire('bin/brief-du-jour.sh');
  assert.ok(prompt.includes('veille/AAAA-MM-JJ.md'), 'le prompt ne nomme pas le fichier de veille');
  assert.ok(script.includes('scripts/veille.mjs'), "le script serveur ne relève pas la veille");
});
