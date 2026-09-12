// Le cours du change, testé sans réseau.
//
// Deux façons de mentir en silence : afficher un cours périmé sous une date
// récente — la BCE se tait le week-end et les jours fériés —, et laisser
// passer une réponse à trous. Le reste est du confort.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { relevéChange, urlCours, DEVISES } from '../scripts/lib/change.mjs';

/** La forme que renvoie vraiment Frankfurter, relevée sur l'API le 13/09/2026. */
const réponse = (date, sur = {}) => ({
  amount: 1.0,
  base: 'CHF',
  date,
  rates: { KRW: 1646.98 },
  ...sur,
});

function faux({ status = 200, corps = réponse('2026-09-11'), lève = null } = {}) {
  const appels = [];
  const fetcher = async (url, options) => {
    appels.push({ url, options });
    if (lève) throw lève;
    return { ok: status >= 200 && status < 300, status, json: async () => corps };
  };
  return { fetcher, appels };
}

test("l'adresse demande le won contre le franc", () => {
  const url = new URL(urlCours());
  assert.equal(url.searchParams.get('base'), 'CHF');
  assert.equal(url.searchParams.get('symbols'), 'KRW');
  assert.deepEqual(DEVISES, { base: 'CHF', quote: 'KRW' });
});

test('une réponse nominale donne un cours normalisé, avec ses deux dates', async () => {
  const { fetcher, appels } = faux();
  const cours = await relevéChange({ date: '2026-09-13' }, { fetcher });

  assert.equal(appels.length, 1);
  assert.equal(cours.date, '2026-09-13', 'le jour du brief');
  assert.equal(cours.rate_date, '2026-09-11', 'le jour du cours : un samedi lit le vendredi');
  assert.equal(cours.rate, 1646.98);
  assert.equal(cours.base, 'CHF');
  assert.equal(cours.quote, 'KRW');
  assert.equal(cours.source, 'frankfurter');
});

test('un cours trop ancien est refusé : mieux vaut pas de bloc qu un bloc périmé', async () => {
  const { fetcher } = faux({ corps: réponse('2026-08-20') });
  await assert.rejects(() => relevéChange({ date: '2026-09-13' }, { fetcher }), /trop ancien/);
});

test('un cours de dix jours passe encore : la BCE se tait presque une semaine à Noël', async () => {
  const { fetcher } = faux({ corps: réponse('2026-12-23') });
  const cours = await relevéChange({ date: '2027-01-02' }, { fetcher });
  assert.equal(cours.rate_date, '2026-12-23');
});

test('un cours du futur est une horloge fausse quelque part, et il est refusé', async () => {
  const { fetcher } = faux({ corps: réponse('2026-09-14') });
  await assert.rejects(() => relevéChange({ date: '2026-09-13' }, { fetcher }), /après le brief/);
});

test('une réponse à trous lève, plutôt que de rendre un cours à zéro', async () => {
  for (const corps of [{ date: '2026-09-11', rates: {} }, { date: '2026-09-11', rates: { KRW: 0 } }, { rates: { KRW: 1600 } }, null]) {
    const { fetcher } = faux({ corps });
    await assert.rejects(() => relevéChange({ date: '2026-09-13' }, { fetcher }), /incomplet/);
  }
});

test('une erreur HTTP est nommée par son code', async () => {
  const { fetcher } = faux({ status: 502 });
  await assert.rejects(() => relevéChange({ date: '2026-09-13' }, { fetcher }), /HTTP 502/);
});

test("un service muet lève avec le délai, pas avec un 'AbortError' abscons", async () => {
  const lève = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { fetcher } = faux({ lève });
  await assert.rejects(
    () => relevéChange({ date: '2026-09-13' }, { fetcher, timeoutMs: 5_000 }),
    /pas de réponse en 5 s/
  );
});
