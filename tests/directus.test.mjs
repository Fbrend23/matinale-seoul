// Le client CMS est le seul endroit où la chaîne touche le réseau pour écrire.
// Ce qui se teste ici n'est pas Directus, c'est la conduite du client quand la
// connexion n'aboutit PAS : ce qu'il rejoue, ce qu'il refuse de rejouer, et ce
// qu'il finit par dire.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '../scripts/lib/directus.mjs';

/** L'échec que jette undici quand la connexion ne s'établit pas. */
const panneRéseau = (code) => new TypeError('fetch failed', { cause: { code } });

const réponse = (data) => ({
  status: 200,
  ok: true,
  headers: new Headers(),
  json: async () => ({ data }),
});

/** Un client dont on pilote les réponses, et qui n'attend jamais vraiment. */
function clientAvec(réponses) {
  const appels = [];
  const fetcher = async (url, options) => {
    appels.push({ url, method: options.method });
    const suite = réponses.shift();
    if (suite instanceof Error) throw suite;
    return suite;
  };
  const client = createClient({
    url: 'https://cms.test',
    token: 'jeton',
    fetcher,
    dormir: async () => {},
  });
  return { client, appels };
}

test('une lecture rejoue une connexion qui ne s’établit pas, puis aboutit', async () => {
  const { client, appels } = clientAvec([
    panneRéseau('ECONNREFUSED'),
    panneRéseau('ECONNREFUSED'),
    réponse([{ id: 7 }]),
  ]);

  assert.deepEqual(await client.get('/items/mat_briefs'), [{ id: 7 }]);
  assert.equal(appels.length, 3, 'deux reprises avant la bonne');
});

test('une lecture abandonne après quatre tentatives, en nommant la panne', async () => {
  const { client, appels } = clientAvec(Array(9).fill(panneRéseau('ENOTFOUND')));

  await assert.rejects(
    () => client.get('/items/mat_briefs'),
    (e) => {
      // Le message doit porter la CAUSE : « fetch failed » seul a déjà coûté
      // une enquête, le 10 septembre 2026.
      assert.match(e.message, /ENOTFOUND/);
      assert.match(e.message, /GET \/items\/mat_briefs/);
      return true;
    }
  );
  assert.equal(appels.length, 4, 'une tentative plus trois reprises');
});

test("une écriture n'est JAMAIS rejouée : un POST reçu sans réponse ferait un doublon", async () => {
  const { client, appels } = clientAvec([panneRéseau('ECONNRESET'), réponse({ id: 1 })]);

  await assert.rejects(() => client.post('/items/mat_news_items', { headline: 'x' }));
  assert.equal(appels.length, 1, 'aucune reprise sur une écriture');
});

test('un 429 est respecté, et il est compté séparément du réseau', async () => {
  const limite = {
    status: 429,
    ok: false,
    headers: new Headers({ 'retry-after': '1' }),
    json: async () => ({}),
  };
  const { client, appels } = clientAvec([limite, limite, réponse([])]);

  assert.deepEqual(await client.get('/items/mat_briefs'), []);
  assert.equal(appels.length, 3);
});

test("une erreur HTTP n'est pas une panne réseau : elle remonte telle quelle", async () => {
  const { client, appels } = clientAvec([
    {
      status: 403,
      ok: false,
      headers: new Headers(),
      json: async () => ({ errors: [{ message: 'Jeton sans droit d’écriture' }] }),
    },
  ]);

  await assert.rejects(() => client.get('/items/mat_briefs'), /403 Jeton sans droit/);
  assert.equal(appels.length, 1, 'un 403 ne se rejoue pas : il ne passera pas mieux');
});
