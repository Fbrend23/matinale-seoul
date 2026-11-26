// La lecture des sources, sans réseau.
//
// Ce qui peut mentir en silence ici : une page d'erreur servie en succès, une
// page d'accueil ou une coquille JavaScript prises pour l'article, et le
// relecteur jugerait un résumé sur un menu.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extrairePage, lirePage, lirePages, tronquer } from '../scripts/lib/pages.mjs';

const TEXTE = 'Le ministère annonce que la ligne ouvrira au printemps. '.repeat(12);
const URL_ARTICLE = 'https://exemple.kr/article/1';
const servir = (html, { status = 200, type = 'text/html; charset=utf-8', url } = {}) => async () => {
  const res = new Response(html, { status, headers: { 'content-type': type } });
  if (url) Object.defineProperty(res, 'url', { value: url });
  return res;
};

test('le texte vient de l\'articleBody, et non du premier <article> de la page', () => {
  const html = `<head><meta content="Le titre &amp; la suite" property="og:title">
    <script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'NewsArticle', datePublished: '2026-11-26T07:00:00+09:00', articleBody: TEXTE }] })}</script></head>
    <body><article>Un renvoi vers autre chose</article></body>`;
  assert.deepEqual(extrairePage(html), { titre: 'Le titre & la suite', publié: '2026-11-26T07:00:00+09:00', texte: TEXTE.trim() });
});

test('sans articleBody, la page est lue sans ses menus ni ses scripts', () => {
  const { texte, titre } = extrairePage(`<head><title>Titre</title></head><body><nav>Menu</nav><script>var x = 'secret';</script><div><p>${TEXTE}</p><p>Le 12&#xC6D4;.</p></div><footer>Mentions</footer></body>`);
  assert.equal(titre, 'Titre');
  assert.match(texte, /printemps\.\nLe 12월\./);
  assert.ok(!/Menu|secret|Mentions/.test(texte));
});

test('refus, page « introuvable » en succès, accueil et coquille vide sont illisibles, et disent pourquoi', async () => {
  const raison = async (url, fetcher) => {
    const p = await lirePage(url, { fetcher });
    assert.equal(p.lisible, false, url);
    return p.raison;
  };
  assert.equal(await raison(URL_ARTICLE, servir(TEXTE, { status: 403 })), 'HTTP 403');
  assert.match(await raison(URL_ARTICLE, servir(`<title> | 연합뉴스</title><body><p>원하시는 페이지를 찾을 수 없습니다.</p><p>${TEXTE}</p></body>`)), /introuvable/);
  assert.match(await raison('https://www.coex.co.kr/', servir(TEXTE)), /page d'accueil/);
  assert.match(await raison(URL_ARTICLE, servir(TEXTE, { url: 'https://exemple.kr/' })), /renvoie vers la page d'accueil/);
  assert.match(await raison(URL_ARTICLE, servir('<body><div id="app"></div></body>')), /trop court/);
  assert.match(await raison(URL_ARTICLE, servir(TEXTE, { type: 'application/pdf' })), /application\/pdf/);
  assert.match(await raison(URL_ARTICLE, async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }); }), /ECONNRESET/);
});

test('un article qui parle d\'une page introuvable reste un article', async () => {
  const p = await lirePage(URL_ARTICLE, { fetcher: servir(`<title>Les liens morts</title><body><p>${TEXTE.repeat(6)} Page not found, disaient-ils.</p></body>`) });
  assert.equal(p.lisible, true);
});

test('une page en EUC-KR se lit, et une adresse partagée n\'est demandée qu\'une fois', async () => {
  const octets = Buffer.concat([Buffer.from('<body><p>'), Buffer.from('c7d1b1db20'.repeat(200), 'hex'), Buffer.from('</p></body>')]);
  const p = await lirePage(URL_ARTICLE, { fetcher: servir(octets, { type: 'text/html; charset=EUC-KR' }) });
  assert.match(p.texte, /^한글 한글/);
  let appels = 0;
  const pages = await lirePages([URL_ARTICLE, URL_ARTICLE], { fetcher: async () => { appels++; return servir(`<p>${TEXTE}</p>`)(); } });
  assert.equal(appels, 1);
  assert.equal(pages.size, 1);
});

test('la coupe se fait en octets, sans casser un caractère', () => {
  assert.deepEqual(tronquer('abc', 10), { texte: 'abc', tronqué: false });
  assert.deepEqual(tronquer('서울서울', 7), { texte: '서울', tronqué: true });
});
