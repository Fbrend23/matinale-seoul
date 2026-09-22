// Le rendu d'une session `agy` en fin de ligne de journal, et le total d'un
// script. Le quota de l'abonnement se compte en tokens : c'est ce que le
// journal doit dire, volet par volet et en tout.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { décrireSession, totalSessions } from '../scripts/lib/agy.mjs';

test('une session se décrit par ses tours et ses tokens, et une session muette ne dit rien', () => {
  assert.equal(décrireSession({ tours: 3, usage: { input_tokens: 1700955, output_tokens: 98314 } }), ', 3 tours, 1700955 tokens lus, 98314 écrits');
  assert.equal(décrireSession({ tours: 1 }), ', 1 tours');
  assert.equal(décrireSession({ usage: { input_tokens: 0, output_tokens: 0 } }), ', 0 tokens lus, 0 écrits');
  assert.equal(décrireSession({}), '');
  assert.equal(décrireSession(), '');
});

test('le total ne compte que les sessions qui ont compté, et se tait si aucune ne l\'a fait', () => {
  const sessions = [
    { usage: { input_tokens: 1200, output_tokens: 30 } },
    { panne: 'quota' },
    { usage: { input_tokens: 800 } },
  ];
  assert.equal(totalSessions(sessions), '2000 tokens lus, 30 écrits, 2 session(s)');
  assert.equal(totalSessions([{ panne: 'quota' }, {}]), '');
  assert.equal(totalSessions([]), '');
});
