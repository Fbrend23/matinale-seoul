// Le contrôle hebdomadaire des liens : ce qui marque, ce qui ne marque pas.
//
// La sanction est durable, le site cesse de lier, donc la règle doit être
// étroite : deux « n'existe pas » à une minute d'écart, et rien d'autre. Ces
// tests gardent chaque porte fermée une par une, avec un fetch factice qui
// répond ce qu'on lui dicte, sonde après sonde.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { àSonder, vérifierLiens, marquer, FENÊTRE_JOURS } from '../scripts/lib/liens-morts.mjs';

/** Un fetch qui répond, pour chaque URL, la liste des statuts dictés, dans l'ordre. */
function fetchDicté(scénario) {
  const vues = [];
  const restants = Object.fromEntries(Object.entries(scénario).map(([u, l]) => [u, [...l]]));
  const fetcher = async (url, init) => {
    vues.push({ url, method: init.method });
    const suite = restants[url] ?? [200];
    const statut = suite.length > 1 ? suite.shift() : suite[0];
    if (statut === 'muet') {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
    return { ok: statut >= 200 && statut < 300, status: statut };
  };
  return { fetcher, vues };
}

const cible = (id, source_url, link_dead_at = null, collection = 'mat_news_items') => ({
  collection,
  id,
  source_url,
  link_dead_at,
});

const sansAttente = { dormir: async () => {}, attenteMs: 0 };

test('un 404 confirmé une minute plus tard est un lien mort', async () => {
  // HEAD puis GET à chaque sonde : quatre réponses 404 pour deux sondes.
  const { fetcher } = fetchDicté({ 'https://a.test/x': [404] });
  const { morts, ressuscités } = await vérifierLiens([cible(1, 'https://a.test/x')], { fetcher, ...sansAttente });
  assert.deepEqual(morts.map((m) => m.id), [1]);
  assert.equal(ressuscités.length, 0);
});

test('un 410 vaut un 404', async () => {
  const { fetcher } = fetchDicté({ 'https://a.test/x': [410] });
  const { morts } = await vérifierLiens([cible(1, 'https://a.test/x')], { fetcher, ...sansAttente });
  assert.equal(morts.length, 1);
});

test('un 404 puis un 200 n est pas un lien mort', async () => {
  // Première sonde : HEAD 404 (pas de GET, 404 conclut). Seconde : HEAD 200.
  const { fetcher } = fetchDicté({ 'https://a.test/x': [404, 200] });
  const { morts } = await vérifierLiens([cible(1, 'https://a.test/x')], { fetcher, ...sansAttente });
  assert.equal(morts.length, 0);
});

test('une panne, un silence, un refus ne marquent jamais', async () => {
  const { fetcher } = fetchDicté({
    'https://a.test/500': [500],
    'https://a.test/muet': ['muet'],
    'https://a.test/403': [403],
  });
  const cibles = [cible(1, 'https://a.test/500'), cible(2, 'https://a.test/muet'), cible(3, 'https://a.test/403')];
  const { morts, ressuscités } = await vérifierLiens(cibles, { fetcher, ...sansAttente, timeoutMs: 50 });
  assert.equal(morts.length, 0);
  assert.equal(ressuscités.length, 0);
});

test('une page marquée qui répond à nouveau est ressuscitée', async () => {
  const { fetcher } = fetchDicté({ 'https://a.test/x': [200] });
  const { morts, ressuscités } = await vérifierLiens([cible(1, 'https://a.test/x', '2026-09-01T00:00:00Z')], { fetcher, ...sansAttente });
  assert.equal(morts.length, 0);
  assert.deepEqual(ressuscités.map((r) => r.id), [1]);
});

test('une page déjà marquée, toujours morte, n est pas resondée ni remarquée', async () => {
  const { fetcher, vues } = fetchDicté({ 'https://a.test/x': [404] });
  const { morts, ressuscités } = await vérifierLiens([cible(1, 'https://a.test/x', '2026-09-01T00:00:00Z')], { fetcher, ...sansAttente });
  assert.equal(morts.length, 0);
  assert.equal(ressuscités.length, 0);
  // Une seule passe : la seconde ne sonde que les candidats, et elle n'en est pas un.
  assert.equal(vues.filter((v) => v.method === 'HEAD').length, 1);
});

test('l attente entre les deux sondes est respectée, et seulement s il y a des candidats', async () => {
  const attentes = [];
  const dormir = async (ms) => attentes.push(ms);

  const sain = fetchDicté({ 'https://a.test/ok': [200] });
  await vérifierLiens([cible(1, 'https://a.test/ok')], { fetcher: sain.fetcher, dormir, attenteMs: 60_000 });
  assert.deepEqual(attentes, [], 'rien à confirmer, on ne dort pas');

  const mort = fetchDicté({ 'https://a.test/x': [404] });
  await vérifierLiens([cible(1, 'https://a.test/x')], { fetcher: mort.fetcher, dormir, attenteMs: 60_000 });
  assert.deepEqual(attentes, [60_000]);
});

test('marquer groupe les clés par collection, et pose la même date partout', async () => {
  const patchs = [];
  const client = { patch: async (chemin, corps) => patchs.push({ chemin, corps }) };
  await marquer(client, {
    morts: [cible(1, 'u'), cible(2, 'u'), cible(9, 'u', null, 'mat_events')],
    ressuscités: [cible(5, 'u', '2026-09-01T00:00:00Z')],
    maintenant: '2026-09-20T03:00:00.000Z',
  });

  assert.deepEqual(patchs, [
    { chemin: '/items/mat_news_items', corps: { keys: [1, 2], data: { link_dead_at: '2026-09-20T03:00:00.000Z' } } },
    { chemin: '/items/mat_events', corps: { keys: [9], data: { link_dead_at: '2026-09-20T03:00:00.000Z' } } },
    { chemin: '/items/mat_news_items', corps: { keys: [5], data: { link_dead_at: null } } },
  ]);
});

test('la fenêtre est de quatre-vingt-dix jours, sur les briefs publiés et les événements non archivés', async () => {
  const appels = [];
  const client = {
    get: async (chemin) => {
      appels.push(chemin);
      if (chemin.includes('mat_news_items')) return [{ id: 1, source_url: 'u', link_dead_at: null }];
      return [{ id: 2, source_url: 'v', link_dead_at: '2026-01-01T00:00:00Z' }];
    },
  };
  const cibles = await àSonder(client, { today: '2026-09-20' });

  assert.equal(FENÊTRE_JOURS, 90);
  assert.match(appels[0], /mat_news_items.*filter\[status\]\[_eq\]=published.*filter\[brief\]\[date\]\[_gte\]=2026-06-22/);
  assert.match(appels[1], /mat_events.*filter\[status\]\[_neq\]=archived.*filter\[end_date\]\[_gte\]=2026-06-22/);
  assert.deepEqual(cibles, [
    { collection: 'mat_news_items', id: 1, source_url: 'u', link_dead_at: null },
    { collection: 'mat_events', id: 2, source_url: 'v', link_dead_at: '2026-01-01T00:00:00Z' },
  ]);
});
