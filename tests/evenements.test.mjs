// Les pop-ups et événements : ce qui est partagé, et ce qui les écarte.
//
// Un événement n'est ni un item ni une rubrique. Il dure au-delà de son brief,
// il a ses propres contrôles, et aucun d'eux ne recale jamais le brief : tout
// ce qui cloche ÉCARTE l'événement, avec un avertissement. C'est cette règle
// — « accessoire, jamais veto » — que ce fichier garde, à côté du lien Naver
// Map, qui est la seule URL que le dépôt s'autorise à construire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  KINDS,
  KIND_LABELS,
  THEMES,
  THEME_LABELS,
  lienNaverMap,
  grouperParÉtat,
  weekEndDe,
  badgeDélai,
  JOURS_URGENTS,
} from '../shared/evenements.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lireJSON = async (...b) => JSON.parse(await readFile(path.join(RACINE, ...b), 'utf8'));

const schéma = await lireJSON('schemas', 'brief.schema.json');

// --- Le schéma et le module partagé disent la même chose ---------------------

test('les genres du schéma sont ceux du module partagé, avec chacun son libellé', () => {
  assert.deepEqual(schéma.$defs.event.properties.kind.enum, KINDS);
  for (const kind of KINDS) assert.ok(KIND_LABELS[kind], `pas de libellé pour « ${kind} »`);
});

test('les thèmes du schéma sont ceux du module partagé, avec chacun son libellé', () => {
  assert.deepEqual(schéma.$defs.event.properties.theme.enum, THEMES);
  for (const theme of THEMES) assert.ok(THEME_LABELS[theme], `pas de libellé pour « ${theme} »`);
});

test('pas de thème « autre » : l onglet ne couvre que ses quatre sujets', () => {
  assert.ok(!THEMES.includes('autre'));
});

test('le tableau events est facultatif, et un événement n accepte aucun champ inventé', () => {
  assert.ok(!schéma.required.includes('events'));
  assert.equal(schéma.$defs.event.additionalProperties, false);
});

// --- Le lien Naver Map -------------------------------------------------------

test('le lien Naver Map est une recherche sur le lieu et le quartier', () => {
  const lien = lienNaverMap({ venue: 'Pokémon Center Seoul', area: 'Seongsu' });
  assert.equal(lien, 'https://map.naver.com/p/search/Pok%C3%A9mon%20Center%20Seoul%20Seongsu');
});

test('sans quartier, la recherche porte sur le seul lieu, sans espace traînant', () => {
  assert.equal(lienNaverMap({ venue: 'KSPO Dome', area: null }), 'https://map.naver.com/p/search/KSPO%20Dome');
});

// --- Le week-end qui vient ----------------------------------------------------

test('le week-end qui vient, vu de chaque jour de la semaine', () => {
  // Le 4 septembre 2026 est un vendredi.
  assert.deepEqual(weekEndDe('2026-09-04'), { samedi: '2026-09-05', dimanche: '2026-09-06' });
  assert.deepEqual(weekEndDe('2026-08-31'), { samedi: '2026-09-05', dimanche: '2026-09-06' }, 'le lundi vise déjà le samedi');
  assert.deepEqual(weekEndDe('2026-09-05'), { samedi: '2026-09-05', dimanche: '2026-09-06' }, 'le samedi, on y est');
  assert.deepEqual(weekEndDe('2026-09-06'), { samedi: '2026-09-05', dimanche: '2026-09-06' }, 'le dimanche, le samedi est passé');
});

// --- Ce week-end, en cours, à venir, terminé ---------------------------------

const ev = (name, start_date, end_date) => ({ name, start_date, end_date });

test('trois groupes sans recouvrement, et les terminés sortent', () => {
  // Vendredi 4 : le week-end est les 5 et 6.
  const { ceWeekEnd, enCours, àVenir, weekEnd } = grouperParÉtat(
    [
      ev('fini', '2026-08-01', '2026-09-03'),
      ev('long pop-up', '2026-09-01', '2026-10-10'),
      ev('ferme vendredi', '2026-09-01', '2026-09-04'),
      ev('concert de dimanche', '2026-09-06', '2026-09-06'),
      ev('semaine prochaine', '2026-09-08', '2026-09-12'),
    ],
    '2026-09-04'
  );

  assert.deepEqual(weekEnd, { samedi: '2026-09-05', dimanche: '2026-09-06' });
  assert.deepEqual(ceWeekEnd.map((e) => e.name), ['long pop-up', 'concert de dimanche']);
  assert.deepEqual(enCours.map((e) => e.name), ['ferme vendredi']);
  assert.deepEqual(àVenir.map((e) => e.name), ['semaine prochaine']);
});

test('le dimanche, ce qui a fermé samedi est terminé, et le week-end se réduit au jour même', () => {
  const { ceWeekEnd, enCours } = grouperParÉtat(
    [ev('fermé hier', '2026-09-01', '2026-09-05'), ev('encore ouvert', '2026-09-01', '2026-09-06')],
    '2026-09-06'
  );
  assert.deepEqual(ceWeekEnd.map((e) => e.name), ['encore ouvert']);
  assert.equal(enCours.length, 0);
});

test('le dernier jour est inclus : un événement qui finit aujourd hui est encore en cours', () => {
  const { enCours } = grouperParÉtat([ev('dernier jour', '2026-09-01', '2026-09-04')], '2026-09-04');
  assert.equal(enCours.length, 1);
});

test('un événement d un seul jour, ce jour-là en semaine, est en cours', () => {
  // Mercredi 2 septembre.
  const { enCours, àVenir, ceWeekEnd } = grouperParÉtat([ev('concert', '2026-09-02', '2026-09-02')], '2026-09-02');
  assert.equal(enCours.length, 1);
  assert.equal(àVenir.length, 0);
  assert.equal(ceWeekEnd.length, 0);
});

test('l ordre d arrivée est conservé dans chaque groupe', () => {
  const { àVenir } = grouperParÉtat([ev('b', '2026-09-09', '2026-09-09'), ev('a', '2026-09-08', '2026-09-08')], '2026-09-01');
  assert.deepEqual(àVenir.map((e) => e.name), ['b', 'a']);
});

// --- Le badge : des jours, pas un « bientôt » --------------------------------

test('le badge compte les jours restants, et passe en urgent sous une semaine', () => {
  assert.deepEqual(badgeDélai(ev('x', '2026-09-01', '2026-09-04'), '2026-09-04'), { texte: 'Dernier jour', urgent: true });
  assert.deepEqual(badgeDélai(ev('x', '2026-09-01', '2026-09-05'), '2026-09-04'), { texte: '1 jour restant', urgent: true });
  assert.deepEqual(badgeDélai(ev('x', '2026-09-01', '2026-09-11'), '2026-09-04'), { texte: '7 jours restants', urgent: true });
  assert.deepEqual(badgeDélai(ev('x', '2026-09-01', '2026-09-12'), '2026-09-04'), { texte: '8 jours restants', urgent: false });
  assert.equal(JOURS_URGENTS, 7);
});

test('le badge d un événement à venir dit dans combien de jours', () => {
  assert.deepEqual(badgeDélai(ev('x', '2026-09-05', '2026-09-06'), '2026-09-04'), { texte: 'Demain', urgent: false });
  assert.deepEqual(badgeDélai(ev('x', '2026-09-20', '2026-09-21'), '2026-09-04'), { texte: 'Dans 16 jours', urgent: false });
});

test('un événement terminé n a pas de badge', () => {
  assert.equal(badgeDélai(ev('x', '2026-08-01', '2026-09-03'), '2026-09-04'), null);
});

// --- Ce qui écarte un événement ----------------------------------------------
//
// Une seule sanction, l'événement écarté. Jamais « retenu en brouillon » comme
// un item au domaine inconnu, jamais « brief recalé » comme une date d'hier :
// un accessoire n'a pas de veto.

import { cohérenceÉvénement, contrôlerÉvénements } from '../scripts/lib/evenements.mjs';

const { domains: domaines } = await lireJSON('config', 'sources.json');
const AUJOURDHUI = '2026-09-04';

const sain = (retouche = {}) => ({
  name: 'Pop-up Pokémon Center à Seongsu',
  kind: 'popup',
  theme: 'pokemon',
  venue: 'Pokémon Center Seoul pop-up',
  area: 'Seongsu',
  start_date: '2026-09-01',
  end_date: '2026-10-12',
  summary: 'Boutique éphémère avec des produits exclusifs.',
  source_name: 'Visit Seoul',
  source_url: 'https://english.visitseoul.net/pop-up-pokemon',
  ...retouche,
});

/** Toutes les URL répondent 200, sauf celles qu'on désigne autrement. */
const sondeur = (parURL = {}) => {
  const vues = [];
  const fetcher = async (url) => {
    vues.push(url);
    const statut = parURL[url] ?? 200;
    return { ok: statut >= 200 && statut < 300, status: statut };
  };
  return { fetcher, vues };
};

const contrôler = (events, options = {}) =>
  contrôlerÉvénements(events, { domaines, today: AUJOURDHUI, fetcher: sondeur().fetcher, ...options });

test('la cohérence d un événement : dates réelles, fin après début, pas encore fini, 40 mots', () => {
  assert.deepEqual(cohérenceÉvénement(sain(), { today: AUJOURDHUI }), []);
  assert.match(cohérenceÉvénement(sain({ start_date: '2026-08-01', end_date: '2026-08-31' }), { today: AUJOURDHUI })[0], /terminé le 2026-08-31/);
  assert.match(cohérenceÉvénement(sain({ start_date: '2026-10-20' }), { today: AUJOURDHUI })[0], /avant d'avoir commencé/);
  assert.match(cohérenceÉvénement(sain({ end_date: '2026-02-31' }), { today: AUJOURDHUI })[0], /irréelle/);
  assert.match(
    cohérenceÉvénement(sain({ summary: Array(41).fill('mot').join(' ') }), { today: AUJOURDHUI })[0],
    /41 mots/
  );
});

test('un événement d un jour, ce jour-là, est cohérent', () => {
  assert.deepEqual(
    cohérenceÉvénement(sain({ start_date: AUJOURDHUI, end_date: AUJOURDHUI }), { today: AUJOURDHUI }),
    []
  );
});

test('un événement sain est retenu, daté de sa vérification', async () => {
  const { retenus, écartés } = await contrôler([sain()]);
  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 1);
  assert.ok(retenus[0].link_checked_at);
});

test('une source morte écarte l événement', async () => {
  const event = sain();
  const { fetcher } = sondeur({ [event.source_url]: 404 });
  const { retenus, écartés } = await contrôler([event], { fetcher });

  assert.equal(retenus.length, 0);
  assert.match(écartés[0].raison, /source morte/);
});

test('un accès refusé garde l événement, sans date de vérification', async () => {
  const event = sain();
  const { fetcher } = sondeur({ [event.source_url]: 403 });
  const { retenus } = await contrôler([event], { fetcher });

  assert.equal(retenus.length, 1);
  assert.equal(retenus[0].link_checked_at, null);
});

test('un domaine inconnu ÉCARTE l événement — il ne retient rien en brouillon', async () => {
  const { retenus, écartés } = await contrôler([sain({ source_url: 'https://blog-inconnu.test/pop-up' })]);

  assert.equal(retenus.length, 0);
  assert.match(écartés[0].raison, /domaine inconnu : blog-inconnu\.test/);
});

test('un événement déjà connu du site est écarté', async () => {
  const { retenus, écartés } = await contrôler([sain()], {
    connus: [{ name: 'Pop-up Pokémon Center à Seongsu' }],
  });

  assert.equal(retenus.length, 0);
  assert.match(écartés[0].raison, /déjà connu \(1\.00\)/);
});

test('un événement terminé est écarté sans coûter une sonde', async () => {
  const { fetcher, vues } = sondeur();
  const { écartés } = await contrôler([sain({ end_date: '2026-09-01' })], { fetcher });

  assert.equal(écartés.length, 1);
  assert.equal(vues.length, 0, "on ne sonde pas l'adresse d'un événement qu'on n'écrira pas");
});

test('une fiche Naver Map morte retire le CHAMP, pas l événement', async () => {
  const event = sain({ map_url: 'https://naver.me/inventé' });
  const { fetcher } = sondeur({ [event.map_url]: 404 });
  const { retenus, écartés, liensRetirés } = await contrôler([event], { fetcher });

  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 1);
  assert.ok(!('map_url' in retenus[0]), 'le site posera son lien de recherche à la place');
  assert.deepEqual(liensRetirés.map((l) => l.champ), ['map_url']);
});

test('une billetterie morte, de même', async () => {
  const event = sain({ booking_url: 'https://tickets.interpark.com/fermé' });
  const { fetcher } = sondeur({ [event.booking_url]: 404 });
  const { retenus, liensRetirés } = await contrôler([event], { fetcher });

  assert.equal(retenus.length, 1);
  assert.ok(!('booking_url' in retenus[0]));
  assert.equal(liensRetirés[0].champ, 'booking_url');
});

test('une fiche Naver Map n est pas une source : elle échappe à l allowlist', async () => {
  // naver.me n'est pas dans config/sources.json, et ne doit pas y être.
  const { retenus, écartés } = await contrôler([sain({ map_url: 'https://naver.me/abc' })]);

  assert.equal(écartés.length, 0);
  assert.equal(retenus[0].map_url, 'https://naver.me/abc');
});

test('les objets de l agent ne sont jamais retouchés', async () => {
  const event = sain({ map_url: 'https://naver.me/inventé' });
  const { fetcher } = sondeur({ [event.map_url]: 404 });
  await contrôler([event], { fetcher });

  assert.equal(event.map_url, 'https://naver.me/inventé');
  assert.ok(!('link_checked_at' in event));
});

test('sans événement, rien à dire', async () => {
  assert.deepEqual(await contrôler([]), { retenus: [], écartés: [], liensRetirés: [], prolongés: [] });
});

// --- Les prolongations -------------------------------------------------------
//
// Un doublon dont les dates ont changé n'est pas un doublon : c'est une fiche
// à corriger. Il passe les mêmes sondes qu'un neuf, et ressort à part.

const connuAvecDates = { id: 3, name: 'Pop-up Pokémon Center à Seongsu', start_date: '2026-09-01', end_date: '2026-09-30' };

test('un événement connu aux dates nouvelles est une prolongation, pas un doublon', async () => {
  const { retenus, écartés, prolongés } = await contrôler([sain({ end_date: '2026-10-12' })], {
    connus: [connuAvecDates],
  });

  assert.equal(retenus.length, 0, 'il ne crée pas de fiche');
  assert.equal(écartés.length, 0);
  assert.equal(prolongés.length, 1);
  assert.equal(prolongés[0].connu.id, 3);
  assert.equal(prolongés[0].event.end_date, '2026-10-12');
  assert.ok(prolongés[0].event.link_checked_at, 'la source a été sondée');
});

test('un événement connu aux mêmes dates reste un doublon', async () => {
  const { écartés, prolongés } = await contrôler([sain({ start_date: '2026-09-01', end_date: '2026-09-30' })], {
    connus: [connuAvecDates],
  });
  assert.equal(prolongés.length, 0);
  assert.match(écartés[0].raison, /déjà connu/);
});

test('une prolongation annoncée par un lien mort est écartée', async () => {
  const event = sain({ end_date: '2026-10-12' });
  const { fetcher } = sondeur({ [event.source_url]: 404 });
  const { écartés, prolongés } = await contrôler([event], { connus: [connuAvecDates], fetcher });
  assert.equal(prolongés.length, 0);
  assert.match(écartés[0].raison, /source morte/);
});
