// Les gardes remplacent la relecture humaine : ce sont elles qu'il faut tester,
// et sur des briefs volontairement cassés, pas seulement sur des briefs sains.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validateSchema,
  checkLinks,
  checkAllowlist,
  findDuplicates,
  checkCoherence,
  similarity,
  seoulDate,
  wordCount,
  flatten,
} from '../scripts/lib/guards.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = async (p) => JSON.parse(await readFile(path.join(RACINE, p), 'utf8'));

const schéma = await lire('schemas/brief.schema.json');
const fixture = (nom) => lire(`tests/fixtures/${nom}.json`);
const valide = await fixture('brief-valide');

// --- Garde 1 : schéma --------------------------------------------------------

test('le brief de référence passe le schéma', async () => {
  assert.deepEqual(validateSchema(valide, schéma), []);
});

test('une section manquante recale le brief', async () => {
  const fautes = validateSchema(await fixture('brief-section-manquante'), schéma);
  assert.ok(fautes.length > 0, 'deux sections sur trois devraient être refusées');
});

test('une section vide sans explication recale le brief', async () => {
  const fautes = validateSchema(await fixture('brief-section-vide-muette'), schéma);
  assert.ok(
    fautes.some((f) => f.includes('empty_note') || f.includes('match')),
    `attendu une faute sur empty_note, reçu : ${fautes.join(' | ')}`
  );
});

test('une URL non HTTPS recale le brief', async () => {
  const fautes = validateSchema(await fixture('brief-url-reconstruite'), schéma);
  assert.ok(fautes.some((f) => f.includes('source_url') || f.includes('pattern')));
});

test('un champ inconnu recale le brief', () => {
  const brief = structuredClone(valide);
  brief.sections[0].items[0].confidence = 0.7;
  assert.ok(validateSchema(brief, schéma).length > 0);
});

// --- Garde 2 : liens vivants -------------------------------------------------

const item = (url) => ({ headline: 'x', summary: 'y', importance: 1, source_url: url });

test('un lien qui répond 200 est gardé', async () => {
  const sondes = await checkLinks([item('https://exemple.test/a')], {
    fetcher: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(sondes[0].ok, true);
  assert.ok(sondes[0].checkedAt);
});

test('un lien qui répond 404 fait sauter l item', async () => {
  const sondes = await checkLinks([item('https://exemple.test/inventé')], {
    fetcher: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(sondes[0].ok, false);
  assert.match(sondes[0].reason, /404/);
});

test('un 405 sur HEAD est réessayé en GET', async () => {
  const appels = [];
  const sondes = await checkLinks([item('https://exemple.test/head-refusé')], {
    fetcher: async (url, opts) => {
      appels.push(opts.method);
      return opts.method === 'HEAD' ? { ok: false, status: 405 } : { ok: true, status: 200 };
    },
  });
  assert.deepEqual(appels, ['HEAD', 'GET']);
  assert.equal(sondes[0].ok, true, 'un serveur qui refuse HEAD ne rend pas le lien mort');
});

// La garde cherche les URL INVENTÉES. Un refus d'accès n'en est pas une : il dit
// qu'on ne nous a pas montré la page, pas qu'elle n'existe pas. Ces quatre tests
// tiennent cette distinction, qui retirait jusqu'ici des items valides en
// silence.

test('un 403 conserve l item : un refus ne prouve pas une URL inventée', async () => {
  const sondes = await checkLinks([item('https://exemple.test/mur-anti-robot')], {
    fetcher: async () => ({ ok: false, status: 403 }),
  });
  assert.equal(sondes[0].verdict, 'refusé');
  assert.equal(sondes[0].ok, true, "un accès refusé ne doit pas retirer l'item");
});

test('un item refusé ne porte pas de date de vérification', async () => {
  const sondes = await checkLinks([item('https://exemple.test/mur-payant')], {
    fetcher: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(
    sondes[0].checkedAt,
    null,
    "dater la vérification d'une page qu'on n'a pas vue serait mentir"
  );
});

test('un 404 reste mort, lui', async () => {
  const sondes = await checkLinks([item('https://exemple.test/inventé')], {
    fetcher: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(sondes[0].verdict, 'mort');
  assert.equal(sondes[0].ok, false);
});

test('un 403 sur HEAD est réessayé en GET avant tout verdict', async () => {
  const appels = [];
  const sondes = await checkLinks([item('https://exemple.test/head-suspect')], {
    fetcher: async (url, opts) => {
      appels.push(opts.method);
      return opts.method === 'HEAD' ? { ok: false, status: 403 } : { ok: true, status: 200 };
    },
  });
  assert.deepEqual(appels, ['HEAD', 'GET']);
  assert.equal(sondes[0].verdict, 'vivant', 'un serveur qui refuse HEAD sert parfois GET');
});

test('la sonde se nomme, plutôt que de laisser Node s annoncer « undici »', async () => {
  let entêtes = null;
  await checkLinks([item('https://exemple.test/a')], {
    fetcher: async (url, opts) => {
      entêtes = opts.headers;
      return { ok: true, status: 200 };
    },
  });
  assert.match(entêtes['User-Agent'], /MatinaleDeSeoul/);
  assert.match(entêtes['User-Agent'], /github\.com/, 'le robot doit dire où le joindre');
});

test('un serveur muet finit par lâcher l item', async () => {
  const sondes = await checkLinks([item('https://exemple.test/lent')], {
    timeoutMs: 20,
    fetcher: (url, opts) =>
      new Promise((_, rejeter) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rejeter(e);
        });
      }),
  });
  assert.equal(sondes[0].ok, false);
  assert.match(sondes[0].reason, /pas de réponse/);
});

// --- Garde 3 : allowlist -----------------------------------------------------

test('un sous-domaine d un domaine connu est connu', () => {
  const inconnus = checkAllowlist([item('https://english.hani.co.kr/arti/1.html')], ['hani.co.kr']);
  assert.equal(inconnus.length, 0);
});

test('un domaine absent de la liste est signalé sans être jeté', () => {
  const source = item('https://blog-inconnu.example/article');
  const inconnus = checkAllowlist([source], ['hani.co.kr']);
  assert.equal(inconnus.length, 1);
  assert.equal(inconnus[0].item, source, 'l item doit être conservé, c est le brief qui attend');
  assert.equal(inconnus[0].host, 'blog-inconnu.example');
});

// --- Garde 4 : doublons ------------------------------------------------------

test('un titre identique est un doublon', () => {
  assert.equal(similarity('Le budget culture augmente', 'Le budget culture augmente'), 1);
});

test('une reformulation proche dépasse le seuil', () => {
  const score = similarity(
    "L'exemption de K-ETA prolongée jusqu'à fin 2027",
    "L'exemption de K-ETA prolongee jusqu a fin 2027"
  );
  assert.ok(score >= 0.85, `score ${score}`);
});

test('deux sujets différents restent sous le seuil', () => {
  const score = similarity(
    'Samsung annonce une mémoire HBM4 pour la mi-2027',
    'Le budget 2027 de la culture augmente de 8 %'
  );
  assert.ok(score < 0.85, `score ${score}`);
});

test('un item déjà couvert les jours précédents est retiré', () => {
  const items = flatten(valide);
  const doublons = findDuplicates(items, ["L'exemption de K-ETA prolongée jusqu'à fin 2027"]);
  assert.equal(doublons.length, 1);
  assert.match(doublons[0].item.headline, /K-ETA/);
});

// --- Garde 5 : cohérence -----------------------------------------------------

test('le brief de référence est cohérent le jour dit', () => {
  assert.deepEqual(checkCoherence(valide, { today: '2026-09-04' }), []);
});

test('un brief daté d hier est recalé', () => {
  const fautes = checkCoherence(valide, { today: '2026-09-05' });
  assert.ok(fautes.some((f) => f.includes('daté du 2026-09-04')));
});

test('une seule section non vide ne fait pas un brief', () => {
  const brief = structuredClone(valide);
  // On vide tout sauf la première. Nommer les index conduirait ce test à passer
  // pour de mauvaises raisons le jour où une rubrique s'ajoute : la règle porte
  // sur le NOMBRE de sections pourvues, jamais sur lesquelles.
  for (const section of brief.sections.slice(1)) {
    section.items = [];
    section.empty_note = 'Rien à signaler.';
  }
  const fautes = checkCoherence(brief, { today: '2026-09-04' });
  assert.ok(fautes.some((f) => f.includes('au moins deux')));
});

test('un résumé de plus de quarante mots est recalé', () => {
  const brief = structuredClone(valide);
  brief.sections[0].items[0].summary = Array.from({ length: 41 }, (_, i) => `mot${i}`).join(' ');
  const fautes = checkCoherence(brief, { today: '2026-09-04' });
  assert.ok(fautes.some((f) => f.includes('41 mots')));
});

test('deux items ne peuvent pas se disputer le même rang', () => {
  const brief = structuredClone(valide);
  brief.sections[0].items[1].importance = 1;
  const fautes = checkCoherence(brief, { today: '2026-09-04' });
  assert.ok(fautes.some((f) => f.includes('même rang')));
});

test('une seule analyse par section', () => {
  const brief = structuredClone(valide);
  brief.sections[2].items[1].analysis = 'Une seconde analyse, de trop.';
  const fautes = checkCoherence(brief, { today: '2026-09-04' });
  assert.ok(fautes.some((f) => f.includes('analyses')));
});

test('quarante mots pile passent', () => {
  const brief = structuredClone(valide);
  brief.sections[0].items[0].summary = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ');
  assert.deepEqual(checkCoherence(brief, { today: '2026-09-04' }), []);
});

// --- Le jour, à Séoul --------------------------------------------------------

test('le jour se lit à Séoul, pas sur le runner', () => {
  // 15 h 30 UTC, c'est déjà minuit et demi le lendemain à Séoul. Un runner en
  // UTC daterait le brief de la veille et la garde de cohérence le recalerait.
  assert.equal(seoulDate(new Date('2026-09-04T15:30:00Z')), '2026-09-05');
  assert.equal(seoulDate(new Date('2026-09-04T14:00:00Z')), '2026-09-04');
});

test('les mots se comptent sans se laisser avoir par la ponctuation', () => {
  assert.equal(wordCount("L'exemption, prolongée : deux ans."), 5);
});

// Le jour de Séoul est désormais calculé dans shared/, parce que le site fait le
// même calcul et qu'un désaccord entre les deux ferait recaler un brief que le
// site daterait pourtant juste.
//
// Le second test garde le chemin PAR DÉFAUT de checkCoherence, le seul qui
// appelle seoulDate() lui-même. Tous les appels du dépôt passent un « today »
// explicite : l'extraction vers shared/ l'a cassé sans qu'aucun test ne rougisse.

test('le jour de Séoul est le même pour les gardes et pour le site', async () => {
  const { seoulToday } = await import('../shared/date.mjs');
  const instant = new Date('2026-09-11T22:30:00Z'); // déjà le 12 à Séoul
  assert.equal(seoulDate(instant), seoulToday(instant));
  assert.equal(seoulDate(instant), '2026-09-12');
});

test('checkCoherence sait dater toute seule, sans « today »', () => {
  const brief = { date: '1999-01-01', sections: [] };
  const erreurs = checkCoherence(brief);
  assert.ok(
    erreurs.some((e) => e.includes('1999-01-01')),
    'la garde doit pouvoir calculer le jour de Séoul elle-même'
  );
});
