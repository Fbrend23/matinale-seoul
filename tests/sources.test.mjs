// Les trois rangs de sources : ce que chacun autorise, et où ils sont appliqués.
//
// Ce qui peut mentir en silence ici : un domaine glissé dans deux rangs (le
// plus permissif gagnerait, et le rang strict ne dirait plus rien) ; un
// agrégateur cité comme source, ce que tout le dépôt refuse ; le contrôle
// avant vol qui jugerait un événement sur une autre liste que l'ingestion, et
// prédirait alors un verdict que la CI contredirait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { rangsDeSources } from '../scripts/lib/sources.mjs';
import { contrôlerÉvénements } from '../scripts/lib/evenements.mjs';
import { checkAllowlist, couvertPar } from '../scripts/lib/guards.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');

const config = JSON.parse(await lire('config/sources.json'));
const { presse, officiels, pourÉvénements, agrégateurs } = rangsDeSources(config);

const AUJOURDHUI = '2026-09-19';
const vivant = async () => ({ ok: true, status: 200 });

const événement = (source_url) => ({
  name: 'Pop-up JISOO CLICK',
  kind: 'popup',
  theme: 'kpop',
  venue: '더현대 서울 5층',
  area: 'Yeouido',
  start_date: '2026-09-19',
  end_date: '2026-09-28',
  summary: 'Boutique éphémère autour du single, entrée libre.',
  source_name: 'The Hyundai',
  source_url,
});

test('les trois rangs sont disjoints, et faits de domaines nus', () => {
  assert.ok(presse.length > 0 && officiels.length > 0 && agrégateurs.length > 0);
  assert.deepEqual(pourÉvénements, [...new Set([...presse, ...officiels])]);

  // Un domaine dans deux rangs : le plus permissif l'emporterait en silence, et
  // le rang strict cesserait de dire quoi que ce soit.
  for (const [nomA, a, nomB, b] of [
    ['domains', presse, 'event_domains', officiels],
    ['domains', presse, 'aggregators', agrégateurs],
    ['event_domains', officiels, 'aggregators', agrégateurs],
  ]) {
    const communs = a.filter((d) => b.includes(d));
    assert.deepEqual(communs, [], `${communs.join(', ')} est à la fois dans ${nomA} et ${nomB}`);
  }

  // Un hôte, et rien d'autre : hostOf() compare des noms d'hôtes en minuscules,
  // sans « www. ». Un « https:// » ou un chemin ne serait jamais reconnu.
  for (const d of [...presse, ...officiels, ...agrégateurs]) {
    assert.match(d, /^[a-z0-9.-]+\.[a-z]{2,}$/, `« ${d} » n'est pas un domaine nu`);
    assert.ok(!d.startsWith('www.'), `« ${d} » : le www. est retiré à la comparaison`);
  }

  // Et un agrégateur ne doit pouvoir servir nulle part.
  for (const d of agrégateurs) {
    assert.ok(!couvertPar(d, pourÉvénements), `${d} passerait comme source d'événement`);
  }
});

test('un événement sourcé chez celui qui l organise passe, le même item retiendrait le brief', async () => {
  // C'est tout l'objet du rang « officiels » : le 19 septembre 2026, l'onglet ne
  // tenait que deux pop-ups K-pop sur quarante-six, parce qu'un pop-up d'idol
  // est annoncé par le grand magasin ou le label, jamais par une rédaction.
  const url = 'https://www.thehyundai.com/event/popup-jisoo-click';
  const { retenus, écartés } = await contrôlerÉvénements([événement(url)], {
    domaines: pourÉvénements,
    agrégateurs,
    today: AUJOURDHUI,
    fetcher: vivant,
  });
  assert.deepEqual(écartés, []);
  assert.equal(retenus.length, 1);

  // La MÊME adresse, en item : elle n'est pas dans la presse, donc le brief
  // entier partirait en brouillon. Les deux rangs ne se confondent pas.
  assert.equal(checkAllowlist([{ source_url: url }], presse).length, 1);
  assert.equal(checkAllowlist([{ source_url: url }], pourÉvénements).length, 0);
});

test('un agrégateur est écarté, et le journal dit quoi faire', async () => {
  const { retenus, écartés } = await contrôlerÉvénements(
    [événement('https://popply.co.kr/popup/4276')],
    { domaines: pourÉvénements, agrégateurs, today: AUJOURDHUI, fetcher: vivant }
  );
  assert.deepEqual(retenus, []);
  // « Domaine inconnu » se corrige en ajoutant le domaine ; celui-ci ne doit
  // jamais entrer, et le journal doit dire l'autre geste.
  assert.match(écartés[0].raison, /agrégateur : popply\.co\.kr recense/);
  assert.match(écartés[0].raison, /retrouve la page du lieu, de la marque ou du label/);

  // Sans la liste des agrégateurs, c'est un domaine inconnu comme un autre :
  // le rang ne change pas le verdict, seulement ce qu'on en dit.
  const sansRang = await contrôlerÉvénements([événement('https://popply.co.kr/popup/4276')], {
    domaines: pourÉvénements,
    today: AUJOURDHUI,
    fetcher: vivant,
  });
  assert.match(sansRang.écartés[0].raison, /domaine inconnu/);
});

test('la consigne de recherche nomme les trois rangs', async () => {
  const recherche = await lire('prompts/recherche-evenements.md');
  for (const gabarit of ['{{DOMAINES}}', '{{OFFICIELS}}', '{{AGREGATEURS}}']) {
    assert.ok(recherche.includes(gabarit), `${gabarit} absent de la consigne de recherche`);
  }
  const { composerConsigne } = await import('../scripts/lib/recherche.mjs');
  const rempli = composerConsigne(recherche, {
    jour: AUJOURDHUI,
    domaines: presse,
    officiels,
    agrégateurs,
  });
  assert.ok(!rempli.includes('{{'), 'un gabarit est resté vide');
  assert.ok(rempli.includes('thehyundai.com') && rempli.includes('popply.co.kr'));
});

test('les quatre scripts qui jugent un événement assemblent la liste au même endroit', async () => {
  // guards.mjs le dit du couple contrôle/ingestion : « le second est censé
  // PRÉDIRE le verdict du premier ». Deux assemblages faits à deux endroits
  // divergeraient le jour où un rang change, et le contrôle annoncerait un
  // verdict que la CI contredirait.
  for (const script of ['scripts/ingest.mjs', 'scripts/preflight.mjs', 'scripts/recherche.mjs', 'scripts/popups.mjs']) {
    const source = await lire(script);
    assert.match(source, /rangsDeSources/, `${script} n'utilise pas lib/sources.mjs`);
    assert.ok(
      !/\{\s*domains\s*[:}]/.test(source),
      `${script} lit encore « domains » directement : le rang se décide dans lib/sources.mjs`
    );
  }
});
