// Le relevé météo, testé sans réseau.
//
// Ce module a deux façons de mentir en silence, et ce sont elles qu'on teste :
// porter sur le mauvais jour — la CI vit en UTC, à quinze heures de Séoul — et
// laisser passer une réponse à trous. Le reste est du confort.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { relevéMétéo, urlRelevé } from '../scripts/lib/meteo.mjs';
import { libelléCiel, CIEL } from '../shared/meteo.mjs';

/** La forme que renvoie vraiment Open-Meteo, relevée sur l'API le 10/09/2026. */
const réponse = (jour, sur = {}) => ({
  utc_offset_seconds: 32_400,
  timezone: 'Asia/Seoul',
  daily: {
    time: [jour],
    weather_code: [3],
    temperature_2m_max: [22.4],
    temperature_2m_min: [14.8],
    precipitation_probability_max: [0],
    precipitation_sum: [0],
    ...sur,
  },
});

/** Faux serveur : enregistre ce qu'on lui demande, répond ce qu'on lui dit. */
function faux({ status = 200, corps = réponse('2026-09-10'), lève = null } = {}) {
  const appels = [];
  const fetcher = async (url, options) => {
    appels.push({ url, options });
    if (lève) throw lève;
    return { ok: status >= 200 && status < 300, status, json: async () => corps };
  };
  return { fetcher, appels };
}

// --- L'adresse, là où se joue le fuseau --------------------------------------

test("l'adresse épingle le jour du brief et le fuseau de Séoul", () => {
  const url = new URL(urlRelevé('2026-09-10'));

  // Ces trois paramètres sont la seule chose qui empêche le bulletin de porter
  // sur le mauvais jour quand le runner tourne en UTC. Le test vaut donc
  // identiquement dans les deux passes de la CI.
  assert.equal(url.searchParams.get('start_date'), '2026-09-10');
  assert.equal(url.searchParams.get('end_date'), '2026-09-10');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Seoul');

  assert.match(url.searchParams.get('daily'), /weather_code/);
  assert.match(url.searchParams.get('daily'), /temperature_2m_min/);
});

// --- Le relevé ---------------------------------------------------------------

test('une réponse nominale donne un bulletin normalisé', async () => {
  const { fetcher, appels } = faux();
  const bulletin = await relevéMétéo({ date: '2026-09-10' }, { fetcher });

  assert.equal(appels.length, 1);
  assert.equal(bulletin.date, '2026-09-10');
  assert.equal(bulletin.tmin, 15, '14,8 °C s’arrondit à 15');
  assert.equal(bulletin.tmax, 22, '22,4 °C s’arrondit à 22');
  assert.equal(bulletin.code, 3);
  assert.equal(bulletin.precip_probability, 0);
  assert.equal(bulletin.source, 'open-meteo');
  assert.match(bulletin.fetched_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('un relevé daté d’un autre jour est refusé', async () => {
  const { fetcher } = faux({ corps: réponse('2026-09-09') });
  await assert.rejects(
    relevéMétéo({ date: '2026-09-10' }, { fetcher }),
    /2026-09-09.*2026-09-10/s,
    'un bulletin daté de la veille serait faux sans en avoir l’air'
  );
});

test('un relevé calculé sur une journée UTC est refusé', async () => {
  // Le cas le plus retors, et la raison d'être du contrôle de décalage : sans
  // le paramètre « timezone », Open-Meteo répond AVEC LA BONNE DATE mais des
  // min/max découpés sur une journée UTC — neuf heures à côté. Contrôler la
  // date seule laisserait passer un bulletin faux qui a l'air juste.
  const { fetcher } = faux({
    corps: { ...réponse('2026-09-10'), utc_offset_seconds: 0, timezone: 'GMT' },
  });
  await assert.rejects(relevéMétéo({ date: '2026-09-10' }, { fetcher }), /pas sur Séoul/);
});

test('une réponse en erreur lève au lieu d’inventer', async () => {
  const { fetcher } = faux({ status: 500 });
  await assert.rejects(relevéMétéo({ date: '2026-09-10' }, { fetcher }), /HTTP 500/);
});

test('un délai dépassé lève, et le dit', async () => {
  const fetcher = (url, { signal }) =>
    new Promise((_, rejette) => {
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    });

  await assert.rejects(relevéMétéo({ date: '2026-09-10' }, { fetcher, timeoutMs: 20 }), /0\.02 s/);
});

test('une réponse à trous est refusée plutôt que rendue en bloc troué', async () => {
  const { fetcher } = faux({ corps: réponse('2026-09-10', { temperature_2m_min: [null] }) });
  await assert.rejects(relevéMétéo({ date: '2026-09-10' }, { fetcher }), /incomplet/);
});

test('une probabilité absente ne fait pas échouer le relevé', async () => {
  // Cas du rejeu tardif : hors fenêtre de prévision, Open-Meteo ne donne plus
  // la probabilité. Le bulletin reste, la ligne disparaît.
  const { fetcher } = faux({
    corps: réponse('2026-09-10', { precipitation_probability_max: [null] }),
  });
  const bulletin = await relevéMétéo({ date: '2026-09-10' }, { fetcher });

  assert.equal(bulletin.precip_probability, null);
  assert.equal(bulletin.tmax, 22);
});

// --- Les libellés ------------------------------------------------------------

test('les codes WMO connus ont un libellé français', () => {
  assert.equal(libelléCiel(0), 'Ciel dégagé');
  assert.equal(libelléCiel(3), 'Couvert');
  assert.equal(libelléCiel(65), 'Pluie forte');
  assert.equal(libelléCiel(95), 'Orage');
});

test('un code inconnu reçoit un libellé, jamais « undefined »', () => {
  // L'OMM ajoute des codes. Un `undefined` rendu tel quel écrirait
  // « undefined » en tête du brief du jour sans que rien n'ait échoué.
  for (const code of [4, 42, 1000, null, undefined]) {
    assert.equal(typeof libelléCiel(code), 'string');
    assert.equal(libelléCiel(code), 'Temps indéterminé');
  }
});

test('aucun libellé n’est vide', () => {
  for (const [code, libellé] of Object.entries(CIEL)) {
    assert.ok(libellé.length > 2, `le code ${code} n’a pas de libellé`);
  }
});
