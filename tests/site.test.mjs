// Les deux pièces du site qui portent une décision, et que rien ne gardait.
//
// src/ était entièrement non testé. La plus grande partie s'y prête mal — les
// pages dépendent d'« astro:env », qui ne se résout pas hors d'Astro — mais ces
// deux-ci n'en dépendent pas, et ce sont précisément celles qui décident :
//
//   · le cache du build, qui pourrait servir du contenu figé sans le dire ;
//   · le fuseau des dates, que tout le reste du dépôt teste ailleurs avec soin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { créerMémo } from '../src/lib/une-fois.js';
import { longDate, shortDate, sourceTime, daysBetween, seoulToday } from '../src/lib/date.js';

// --- Le cache du build -------------------------------------------------------

test('une clé ne produit sa valeur qu une fois', async () => {
  const mémo = créerMémo();
  let appels = 0;
  const produire = async () => ++appels;

  assert.equal(await mémo('briefs', produire), 1);
  assert.equal(await mémo('briefs', produire), 1);
  assert.equal(appels, 1);
});

test('deux clés ne se mélangent pas', async () => {
  const mémo = créerMémo();
  assert.equal(await mémo('a', async () => 'briefs'), 'briefs');
  assert.equal(await mémo('b', async () => 'items'), 'items');
});

test('deux appels en parallèle partagent la requête EN VOL', async () => {
  // Mémoïser la valeur plutôt que la promesse laisserait les deux partir avant
  // que la première ne revienne : deux requêtes au CMS pour une réponse.
  const mémo = créerMémo();
  let appels = 0;
  const lent = () =>
    new Promise((résoudre) => {
      appels++;
      setTimeout(() => résoudre('data'), 20);
    });

  const [a, b] = await Promise.all([mémo('k', lent), mémo('k', lent)]);

  assert.deepEqual([a, b], ['data', 'data']);
  assert.equal(appels, 1);
});

test('un rejet est relancé à l identique, et ne devient jamais un repli', async () => {
  // La propriété la plus importante du fichier. Quand le CMS ne répond pas, le
  // build doit ÉCHOUER — le déploiement précédent reste alors en ligne, et le
  // lecteur voit le brief d'hier, ce qui est vrai. Un cache qui avalerait la
  // panne publierait un site éternellement frais et faux.
  const mémo = créerMémo();
  const panne = async () => {
    throw new Error('CMS injoignable (ECONNREFUSED)');
  };

  for (const essai of [1, 2, 3]) {
    await assert.rejects(
      () => mémo('briefs', panne),
      /CMS injoignable/,
      `l'essai ${essai} doit lever comme le premier`
    );
  }
});

test('deux mémos ne partagent rien', async () => {
  const a = créerMémo();
  const b = créerMémo();
  assert.equal(await a('k', async () => 1), 1);
  assert.equal(await b('k', async () => 2), 2);
});

// --- Les dates du site -------------------------------------------------------
//
// Le runner qui construit le site vit en UTC, et le brief parle de Séoul : ces
// fonctions sont exactement celles qui dateraient un brief de la veille si un
// fuseau y était sous-entendu. La CI les joue deux fois, dans les deux fuseaux.

test('la date longue est celle du jour annoncé, quel que soit le fuseau', () => {
  assert.equal(longDate('2026-09-04'), 'vendredi 4 septembre 2026');
  // Le 1er du mois est le cas qui bascule : minuit à Séoul, c'est encore la
  // veille en UTC.
  assert.equal(longDate('2026-01-01'), 'jeudi 1 janvier 2026');
  assert.equal(longDate('2026-12-31'), 'jeudi 31 décembre 2026');
});

test('la date courte sert les listes d archive', () => {
  assert.equal(shortDate('2026-09-04'), '4 sept.');
  assert.equal(shortDate('2026-01-01'), '1 janv.');
});

test("l'heure d'une source est dite à Séoul, puisque c'est là qu'on lit", () => {
  // 23 h 30 UTC le 3, c'est 8 h 30 le 4 à Séoul. Un lecteur qui verrait « 3 sept.
  // 23:30 » sous un brief du 4 croirait l'article de la veille.
  assert.equal(sourceTime('2026-09-03T23:30:00Z'), '4 sept., 08:30');
  assert.equal(sourceTime(null), null, 'une source sans horodatage fiable n en affiche pas');
});

test('l écart entre deux jours se compte en jours, pas en heures', () => {
  assert.equal(daysBetween('2026-09-03', '2026-09-04'), 1);
  assert.equal(daysBetween('2026-09-04', '2026-09-04'), 0);
  assert.equal(daysBetween('2026-09-04', '2026-09-03'), -1);
  // Par-dessus un changement d'heure européen : le calcul est ancré sur UTC,
  // il ne doit pas rendre 30,96 jours arrondis au petit bonheur.
  assert.equal(daysBetween('2026-03-15', '2026-04-15'), 31);
});

test('le site et les gardes datent le même jour à Séoul', () => {
  const instant = new Date('2026-09-11T22:30:00Z'); // déjà le 12 là-bas
  assert.equal(seoulToday(instant), '2026-09-12');
});
