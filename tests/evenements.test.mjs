// Les pop-ups et événements : ce qui est partagé, et ce qui les écarte.
//
// Un événement n'est ni un item ni une rubrique. Il dure au-delà de son brief,
// il a ses propres contrôles, et aucun d'eux ne recale jamais le brief : tout
// ce qui cloche ÉCARTE l'événement, avec un avertissement. C'est cette règle,
// « accessoire, jamais veto », que ce fichier garde, à côté du lien Naver
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
  trierEvents,
  comparateur,
  TRIS,
  TRI_LABELS,
  TRI_PAR_DEFAUT,
  badgeDélai,
  JOURS_URGENTS,
  FENÊTRE_LANCEMENT,
  compléterFin,
} from '../shared/evenements.mjs';
import { correspond } from '../shared/texte.mjs';

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

test('pas de thème « autre » : chacun des sujets de l onglet a un nom', () => {
  assert.ok(!THEMES.includes('autre'));
});

test('le tableau events est facultatif, et un événement n accepte aucun champ inventé', () => {
  assert.ok(!schéma.required.includes('events'));
  assert.equal(schéma.$defs.event.additionalProperties, false);
});

// --- Le lien Naver Map -------------------------------------------------------

test('le lien Naver Map est une recherche sur le lieu seul, en coréen', () => {
  // Le quartier reste hors de la requête : romanisé, il brouillerait une
  // recherche coréenne. L'enseigne se départage dans le lieu lui-même.
  const lien = lienNaverMap({ venue: '포켓몬센터 성수', area: 'Seongsu' });
  assert.equal(lien, 'https://map.naver.com/p/search/%ED%8F%AC%EC%BC%93%EB%AA%AC%EC%84%BC%ED%84%B0%20%EC%84%B1%EC%88%98');
});

test('le lieu est nettoyé de ses espaces avant la recherche', () => {
  assert.equal(lienNaverMap({ venue: ' 하이커그라운드 ', area: null }), 'https://map.naver.com/p/search/%ED%95%98%EC%9D%B4%EC%BB%A4%EA%B7%B8%EB%9D%BC%EC%9A%B4%EB%93%9C');
});

// --- En cours, à venir, terminé ----------------------------------------------

const ev = (name, start_date, end_date) => ({ name, start_date, end_date });

test('deux groupes sans recouvrement, et les terminés sortent', () => {
  const { enCours, àVenir } = grouperParÉtat(
    [
      ev('fini', '2026-08-01', '2026-09-03'),
      ev('long pop-up', '2026-09-01', '2026-10-10'),
      ev('ferme aujourd hui', '2026-09-01', '2026-09-04'),
      ev('concert de dimanche', '2026-09-06', '2026-09-06'),
      ev('semaine prochaine', '2026-09-08', '2026-09-12'),
    ],
    '2026-09-04'
  );

  assert.deepEqual(enCours.map((e) => e.name), ['long pop-up', 'ferme aujourd hui']);
  assert.deepEqual(àVenir.map((e) => e.name), ['concert de dimanche', 'semaine prochaine']);
});

test('le dernier jour est inclus : un événement qui finit aujourd hui est encore en cours', () => {
  const { enCours } = grouperParÉtat([ev('dernier jour', '2026-09-01', '2026-09-04')], '2026-09-04');
  assert.equal(enCours.length, 1);
});

test('un événement d un seul jour, ce jour-là, est en cours', () => {
  const { enCours, àVenir } = grouperParÉtat([ev('concert', '2026-09-02', '2026-09-02')], '2026-09-02');
  assert.equal(enCours.length, 1);
  assert.equal(àVenir.length, 0);
});

test('l ordre d arrivée est conservé dans chaque groupe', () => {
  const { àVenir } = grouperParÉtat([ev('b', '2026-09-09', '2026-09-09'), ev('a', '2026-09-08', '2026-09-08')], '2026-09-01');
  assert.deepEqual(àVenir.map((e) => e.name), ['b', 'a']);
});

// --- Le tri : ce qui finit le plus tôt d'abord ------------------------------

test('chaque tri a un libellé, et le tri du build est le premier du menu', () => {
  for (const tri of TRIS) assert.ok(TRI_LABELS[tri], tri);
  assert.equal(TRI_PAR_DEFAUT, 'fin');
});

const evc = (name, start_date, end_date, date_created) => ({ name, start_date, end_date, date_created });
const jeu = [
  evc('long pop-up', '2026-09-01', '2026-10-10', '2026-08-20T00:00:00Z'),
  evc('finit demain', '2026-08-15', '2026-09-05', '2026-09-03T00:00:00Z'),
  evc('concert', '2026-09-06', '2026-09-06', '2026-09-01T00:00:00Z'),
];

test('par défaut, ce qui finit le plus tôt vient en premier', () => {
  assert.deepEqual(trierEvents(jeu).map((e) => e.name), ['finit demain', 'concert', 'long pop-up']);
});

test('« debut » range par date de début, « nouveau » du dernier repéré au premier', () => {
  assert.deepEqual(trierEvents(jeu, 'debut').map((e) => e.name), ['finit demain', 'long pop-up', 'concert']);
  assert.deepEqual(trierEvents(jeu, 'nouveau').map((e) => e.name), ['finit demain', 'concert', 'long pop-up']);
});

test('à dates égales, le nom départage : deux builds rangent pareil', () => {
  const pareils = [evc('b', '2026-09-01', '2026-09-10'), evc('a', '2026-09-01', '2026-09-10')];
  assert.deepEqual(trierEvents(pareils).map((e) => e.name), ['a', 'b']);
  assert.deepEqual(trierEvents(pareils, 'debut').map((e) => e.name), ['a', 'b']);
  assert.deepEqual(trierEvents(pareils, 'nouveau').map((e) => e.name), ['a', 'b']);
});

test('le tri ne touche pas la liste reçue', () => {
  const copie = [...jeu];
  trierEvents(jeu);
  assert.deepEqual(jeu, copie);
});

test('un tri inconnu retombe sur celui du build', () => {
  assert.deepEqual(trierEvents(jeu, 'nimporte').map((e) => e.name), trierEvents(jeu).map((e) => e.name));
  assert.equal(comparateur('nimporte')(jeu[0], jeu[1]), comparateur(TRI_PAR_DEFAUT)(jeu[0], jeu[1]));
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

// --- La recherche de l'onglet : chaque mot, sans accents ni casse ------------

test('la recherche ignore les accents, la casse et la ponctuation', () => {
  assert.ok(correspond('pokemon', 'Pokémon Center'));
  assert.ok(correspond('POKÉMON', 'pokemon center'));
  assert.ok(correspond('k-pop', 'K-pop'));
  assert.ok(correspond('kpop', 'K-pop'));
  // « k-pop » est un mot, pas deux : sinon « k » trouverait presque tout.
  assert.ok(!correspond('k-pop', 'Pop-up Pokémon Center'));
});

test('chaque mot de la requête doit se trouver, dans n importe quel ordre', () => {
  const texte = 'Pokémon Center 포켓몬센터 성수 · Seongsu';
  assert.ok(correspond('seongsu pokemon', texte));
  assert.ok(!correspond('pokemon hongdae', texte));
});

test('le hangul se cherche par sous-chaîne : une syllabe trouve le mot', () => {
  assert.ok(correspond('포켓몬', '포켓몬센터 성수'));
  assert.ok(correspond('성수', '포켓몬센터 성수'));
  assert.ok(!correspond('홍대', '포켓몬센터 성수'));
});

test('une requête vide ne filtre rien', () => {
  assert.ok(correspond('', 'n importe quoi'));
  assert.ok(correspond('   ', 'n importe quoi'));
  assert.ok(correspond('', ''));
  assert.ok(!correspond('x', ''));
});

// --- Ce qui écarte un événement ----------------------------------------------
//
// Une seule sanction, l'événement écarté. Jamais « retenu en brouillon » comme
// un item au domaine inconnu, jamais « brief recalé » comme une date d'hier :
// un accessoire n'a pas de veto.

import { cohérenceÉvénement, contrôlerÉvénements, doublonParLieu, DUPLICATE_THRESHOLD_LIEU } from '../scripts/lib/evenements.mjs';
import { similarity, DUPLICATE_THRESHOLD } from '../scripts/lib/guards.mjs';
import { validateSchema } from '../scripts/lib/guards.mjs';

// La fixture, pour valider un événement dans un brief entier : le schéma ne
// se valide qu'à la racine.
const exempleDeBrief = await lireJSON('tests', 'fixtures', 'brief-avec-evenements.json');

const { domains: domaines } = await lireJSON('config', 'sources.json');
const AUJOURDHUI = '2026-09-04';

const sain = (retouche = {}) => ({
  name: 'Pop-up Pokémon Center à Seongsu',
  kind: 'popup',
  theme: 'pokemon',
  venue: '포켓몬센터 성수',
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
});

test('un lieu sans hangul est une faute, sauf si la fiche Naver Map a été vue', () => {
  // Le bouton Naver Map cherche le lieu tel quel : « Hiker Ground » n'y trouve
  // rien, « 하이커그라운드 » si. Avec une fiche vue, la recherche ne sert plus.
  assert.match(cohérenceÉvénement(sain({ venue: 'Hiker Ground' }), { today: AUJOURDHUI })[0], /lieu sans hangul/);
  assert.deepEqual(cohérenceÉvénement(sain({ venue: 'Hiker Ground', map_url: 'https://naver.me/abc' }), { today: AUJOURDHUI }), []);
  assert.deepEqual(cohérenceÉvénement(sain({ venue: 'KSPO돔' }), { today: AUJOURDHUI }), []);
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

test('un domaine inconnu ÉCARTE l événement, il ne retient rien en brouillon', async () => {
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

test('une adresse sans hangul retire le CHAMP, pas l événement ; en coréen, elle passe', async () => {
  // La carte géocode du coréen : une adresse en lettres latines ne poserait
  // rien. Le champ saute, l'événement reste, et le journal le dit.
  const latine = sain({ address: '7 Achasan-ro, Seongdong-gu' });
  const coréenne = sain({ name: 'Autre pop-up', address: '서울 성동구 아차산로 7' });
  const { retenus, écartés, liensRetirés } = await contrôler([latine, coréenne]);

  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 2);
  assert.ok(!('address' in retenus[0]));
  assert.equal(retenus[1].address, '서울 성동구 아차산로 7');
  assert.deepEqual(liensRetirés.map((l) => l.champ), ['address']);
  assert.match(liensRetirés[0].raison, /sans hangul/);
  assert.equal(latine.address, '7 Achasan-ro, Seongdong-gu', "l'objet de l'agent n'est pas retouché");
});

test('le schéma accepte une adresse, facultative, et la borne à 200 caractères', () => {
  const brief = { ...exempleDeBrief, events: [sain({ address: '서울 성동구 아차산로 7' })] };
  assert.deepEqual(validateSchema(brief, schéma), []);
  assert.deepEqual(validateSchema({ ...brief, events: [sain()] }, schéma), []);
  assert.notDeepEqual(validateSchema({ ...brief, events: [sain({ address: '서'.repeat(201) })] }, schéma), []);
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

// --- Le doublon par le lieu --------------------------------------------------
//
// Deux rédactions ne nomment presque jamais un pop-up dans les mêmes mots, et
// le nom seul en laisse passer. Le lieu, les dates et le thème concordent
// alors, et le nom n'a plus qu'à confirmer à moitié. Mais COEX accueille
// plusieurs pop-ups la même semaine : le lieu seul n'accuse personne.

const connuAuLieu = {
  id: 4,
  name: 'Pokémon Center Seongsu : le pop-up d’automne',
  theme: 'pokemon',
  venue: '포켓몬센터  성수',
  start_date: '2026-09-01',
  end_date: '2026-10-12',
  source_url: 'https://www.koreaherald.com/article/pokemon-seongsu',
};

test('même lieu, dates qui se recouvrent, même thème, nom à moitié : écarté', async () => {
  const event = sain({ name: 'Pop-up Pokémon Center Seongsu' });
  assert.ok(similarity(event.name, connuAuLieu.name) < DUPLICATE_THRESHOLD, 'le nom seul ne suffit pas');
  assert.ok(similarity(event.name, connuAuLieu.name) >= DUPLICATE_THRESHOLD_LIEU);

  const { retenus, écartés, prolongés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.equal(retenus.length, 0);
  assert.equal(prolongés.length, 0);
  assert.match(écartés[0].raison, /déjà connu par le lieu/);
});

test('même lieu et même thème, mais les dates diffèrent : une prolongation', async () => {
  const event = sain({ name: 'Pop-up Pokémon Center Seongsu', end_date: '2026-11-30' });
  const { prolongés, écartés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.equal(écartés.length, 0);
  assert.equal(prolongés.length, 1);
  assert.equal(prolongés[0].connu.id, 4);
});

test('même lieu, même semaine, autre thème : deux événements', async () => {
  const event = sain({ name: 'Pop-up Chiikawa Seongsu', theme: 'personnages' });
  const { retenus, écartés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 1);
});

test('même lieu, même thème, mais un nom sans rapport : deux événements', async () => {
  const event = sain({ name: 'Tournoi Pokémon Unite' });
  assert.ok(similarity(event.name, connuAuLieu.name) < DUPLICATE_THRESHOLD_LIEU);
  const { retenus, écartés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 1);
});

test('même lieu, dates disjointes : deux événements', async () => {
  const event = sain({ name: 'Pop-up Pokémon Center Seongsu', start_date: '2026-11-01', end_date: '2026-11-30' });
  const { retenus, écartés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.equal(écartés.length, 0);
  assert.equal(retenus.length, 1);
});

test('la même source au même lieu suffit, quel que soit le nom', async () => {
  const event = sain({
    name: '포켓몬센터 성수 가을 팝업',
    theme: 'personnages',
    source_name: 'Korea Herald',
    source_url: 'https://www.koreaherald.com/article/pokemon-seongsu/?utm_source=x',
  });
  const { écartés } = await contrôler([event], { connus: [connuAuLieu] });
  assert.match(écartés[0].raison, /même source/);

  // Un paramètre qui désigne la page n'est pas un utm : deux fiches de
  // festival.seoul.go.kr ne diffèrent que par lui.
  const fiche = (festacode, name) => sain({
    name,
    theme: 'seoul',
    venue: '동대문디자인플라자',
    source_name: 'Séoul',
    source_url: `https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=${festacode}`,
  });
  const deux = await contrôler([fiche(702, 'Seoul Walk Festival')], { connus: [{ ...fiche(333, 'EnterTech Seoul'), id: 9 }] });
  assert.equal(deux.retenus.length, 1, `deux fiches, deux festivals : ${deux.écartés[0]?.raison}`);
});

test('une fiche connue sans lieu ni thème ne peut pas accuser', async () => {
  const event = sain({ name: 'Pop-up Pokémon Center Seongsu' });
  const { retenus } = await contrôler([event], { connus: [{ id: 5, name: 'Pokémon Center Seongsu : le pop-up d’automne' }] });
  assert.equal(retenus.length, 1);
});

test('doublonParLieu rend le mieux nommé, et la preuve', () => {
  const event = sain({ name: 'Pop-up Pokémon Center Seongsu' });
  const autre = { ...connuAuLieu, id: 9, name: 'Pokémon Seongsu' };
  const trouvé = doublonParLieu(event, [autre, connuAuLieu]);
  assert.equal(trouvé.connu.id, 4);
  assert.match(trouvé.preuve, /même thème/);
  assert.equal(doublonParLieu(sain({ venue: '' }), [connuAuLieu]), null);
});

test('une prolongation annoncée par un lien mort est écartée', async () => {
  const event = sain({ end_date: '2026-10-12' });
  const { fetcher } = sondeur({ [event.source_url]: 404 });
  const { écartés, prolongés } = await contrôler([event], { connus: [connuAvecDates], fetcher });
  assert.equal(prolongés.length, 0);
  assert.match(écartés[0].raison, /source morte/);
});

// --- Les lancements en magasin -----------------------------------------------
//
// McDonald's × G-Dragon, 28 septembre 2026 : trois objets Peaceminusone au
// comptoir de tous les McDonald's, « jusqu'à épuisement ». Ni lieu unique ni
// fin annoncée ; la fin est la fenêtre de l'onglet, posée par le code.

const lancement = (retouche = {}) => {
  const { end_date, ...sansFin } = sain({
    name: 'McDonald’s × G-Dragon : les objets Peaceminusone',
    kind: 'lancement',
    theme: 'kpop',
    venue: '맥도날드',
    area: 'Toute la Corée',
    start_date: '2026-09-28',
    source_name: 'The Korea Herald',
    source_url: 'https://www.koreaherald.com/article/10878648',
  });
  return { ...sansFin, ...retouche };
};

test('un lancement peut omettre sa fin, aucun autre événement', () => {
  const brief = structuredClone(exempleDeBrief);
  assert.deepEqual(validateSchema({ ...brief, events: [lancement()] }, schéma), []);
  const { end_date, ...popupSansFin } = sain();
  assert.notDeepEqual(validateSchema({ ...brief, events: [popupSansFin] }, schéma), []);
});

test('un lancement sans fin reçoit la fenêtre de l onglet, jour du lancement compris', async () => {
  assert.equal(FENÊTRE_LANCEMENT, 14);
  const { retenus, écartés } = await contrôler([lancement()]);
  assert.deepEqual(écartés, []);
  assert.equal(retenus[0].end_date, '2026-10-11');
});

test('un lancement qui annonce sa fin la garde', async () => {
  const { retenus } = await contrôler([lancement({ end_date: '2026-10-31' })]);
  assert.equal(retenus[0].end_date, '2026-10-31');
});

test('reproposé le lendemain, un lancement retombe sur les mêmes dates : doublon', async () => {
  const hier = compléterFin(lancement());
  const { retenus, écartés, prolongés } = await contrôler([lancement()], { connus: [hier] });
  assert.deepEqual(retenus, []);
  assert.deepEqual(prolongés, []);
  assert.match(écartés[0].raison, /déjà connu/);
});

test('un lancement lancé depuis plus de deux semaines est terminé', () => {
  const vieux = compléterFin(lancement({ start_date: '2026-08-01' }));
  assert.match(cohérenceÉvénement(vieux, { today: AUJOURDHUI })[0], /terminé le 2026-08-14/);
});

test('compléterFin ne touche ni un autre genre, ni l objet reçu', () => {
  const { end_date, ...popupSansFin } = sain();
  assert.equal(compléterFin(popupSansFin), popupSansFin);
  const reçu = lancement();
  compléterFin(reçu);
  assert.equal(reçu.end_date, undefined);
});

test('le badge d un lancement ne décompte pas sa fenêtre', () => {
  const l = compléterFin(lancement());
  assert.deepEqual(badgeDélai(l, '2026-10-10'), { texte: 'En vente', urgent: false });
  assert.deepEqual(badgeDélai(l, '2026-09-27'), { texte: 'Demain', urgent: false });
  assert.equal(badgeDélai(l, '2026-10-12'), null);
});
