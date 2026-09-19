// Le balayage par entité, testé sans réseau.
//
// Ce qui peut mentir en silence ici : un mot trop large qui ferait surveiller
// la moitié de la K-pop, et coûterait une requête par matin à Gemini pour rien ;
// un nom mal découpé, qui donnerait une requête qui ne trouve jamais ; une
// liste qui ne périme pas, et qui ferait chercher en octobre un comeback de
// septembre ; un gabarit laissé vide dans la consigne.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  nomDuTitre,
  titresDuFlux,
  titresDeLaVeille,
  repérer,
  fusionner,
  rendreSurveillées,
  relever,
  FENÊTRE_JOURS,
  MAX_SURVEILLÉES,
} from '../scripts/lib/entites.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lire = (p) => readFile(path.join(RACINE, p), 'utf8');
const JOUR = '2026-09-19';

test('un titre qui annonce une sortie rend son nom, les autres ne rendent rien', () => {
  // Des titres réels du flux Soompi, le 19 septembre 2026.
  assert.deepEqual(nomDuTitre('RESCENE Announces Comeback Date'), { nom: 'RESCENE', signal: 'comeback' });
  assert.equal(nomDuTitre('Update: PLAVE Shares Concept Photos For “HYPERDRIVE” Comeback').nom, 'PLAVE');
  assert.equal(nomDuTitre('Update: ZEROBASEONE Unveils Track List For Unit ZEROBASEONE EMP’s Mixtape').nom, 'ZEROBASEONE');
  // L'apostrophe saute : c'est une requête, pas une fiche d'état civil.
  assert.equal(nomDuTitre('BLACKPINK’s Jisoo Announces Comeback With New Single').nom, 'BLACKPINK Jisoo');
  // Et dans sa seconde forme, l'apostrophe seule après un nom en -s : elle
  // passait pour un guillemet, et NewJeans, Stray Kids, The Boyz perdaient
  // leurs solistes.
  assert.equal(nomDuTitre('NewJeans’ Hanni Releases Solo Single').nom, 'NewJeans Hanni');
  assert.equal(nomDuTitre("Stray Kids' Felix Drops Solo Track").nom, 'Stray Kids Felix');

  // ET CE QUI N'EST PAS UNE SORTIE. « debut » seul et « unveils » seul ont été
  // écartés pour ces deux titres-là, qui auraient coûté deux requêtes par
  // matin.
  assert.equal(nomDuTitre('IU Makes Generous Donations On Her 18th Debut Anniversary'), null);
  assert.equal(nomDuTitre('SISTAR’s Dasom Signs With New Agency + Unveils New Profile Photos'), null);
  assert.equal(nomDuTitre('BTS, BLACKPINK, CORTIS, And KATSEYE Score Additional Nominations For 2026 MTV VMAs'), null);
  // Un titre d'œuvre entre guillemets n'est pas un nom d'artiste.
  assert.equal(nomDuTitre('“Undercover Chef” Announces New Spin-Off To Air Later This Year'), null);

  // Le coréen : le sujet est avant la virgule.
  assert.deepEqual(nomDuTitre('블랙핑크 지수, 9월 4일 솔로 컴백'), { nom: '블랙핑크 지수', signal: '컴백' });
  assert.equal(nomDuTitre('아이유, 데뷔 기념일 맞아 2억원 기부'), null);
  // 발매 seul vend aussi des téléphones : Samsung n'a pas de comeback.
  assert.equal(nomDuTitre('삼성전자, 갤럭시 Z 폴드 신제품 발매'), null);
  assert.equal(nomDuTitre('[속보] 방탄소년단 컴백 앨범 발매일 확정').nom, '방탄소년단');
  assert.equal(nomDuTitre('르세라핌, 두 번째 싱글 발매').nom, '르세라핌');
});

test('les titres viennent du flux et de la veille, pas des résumés français du site', () => {
  const maintenant = new Date('2026-09-19T07:00:00+09:00');
  const flux = `<rss><channel>
    <item><title>RESCENE Announces Comeback Date</title><link>https://www.soompi.com/a</link><pubDate>Fri, 18 Sep 2026 22:00:00 +0000</pubDate></item>
    <item><title>izna To Return With New Mini Album</title><link>https://www.soompi.com/b</link><pubDate>Fri, 18 Sep 2026 20:00:00 +0000</pubDate></item>
    <item><title>Old News Announces Comeback</title><link>https://www.soompi.com/c</link><pubDate>Mon, 01 Sep 2026 10:00:00 +0000</pubDate></item>
  </channel></rss>`;
  assert.deepEqual(titresDuFlux(flux, { maintenant }), [
    'RESCENE Announces Comeback Date',
    'izna To Return With New Mini Album',
  ]);

  // La veille mêle les titres de flux (datés à la seconde) aux résumés
  // français du site (datés au jour) : seuls les premiers sont des titres de
  // rédaction, et un résumé français ne porte pas les mots d'une annonce.
  const veille = [
    '- 2026-09-18 · coree · Lee Jae-myung affronte la presse',
    '- 2026-09-19T01:40:00+09:00 · 세븐틴, 10월 새 앨범 발매',
    '  https://www.yna.co.kr/view/AKR1',
  ].join('\n');
  assert.deepEqual(titresDeLaVeille(veille), ['세븐틴, 10월 새 앨범 발매']);
  assert.deepEqual(repérer(titresDeLaVeille(veille), { source: 'veille' }).map((e) => e.nom), ['세븐틴']);
});

test('la liste garde la première vue, rafraîchit la dernière, et périme à trois semaines', () => {
  const vieux = { nom: 'Ancien', signal: 'comeback', source: 'Soompi', vu: '2026-08-01', revu: '2026-08-01' };
  const encore = { nom: 'RESCENE', signal: 'comeback', source: 'Soompi', vu: '2026-09-10', revu: '2026-09-10' };
  const liste = fusionner([vieux, encore], [{ nom: 'RESCENE', signal: 'tour', source: 'Soompi' }, { nom: 'izna', signal: 'to return', source: 'veille' }], { jour: JOUR });

  // Périmé : vu il y a plus de trois semaines, et jamais revu.
  assert.ok(!liste.some((e) => e.nom === 'Ancien'), `${FENÊTRE_JOURS} jours : « Ancien » devait sortir`);
  const rescene = liste.find((e) => e.nom === 'RESCENE');
  assert.equal(rescene.vu, '2026-09-10', 'la première vue ne bouge pas');
  assert.equal(rescene.revu, JOUR, 'la dernière vue fait courir la fenêtre');
  assert.equal(rescene.signal, 'tour');
  // À égalité de « revu », la sortie la plus ancienne passe devant : c'est
  // celle dont le pop-up est mûr, et le plafond ne laisse passer que six noms.
  assert.deepEqual(liste.map((e) => e.nom), ['RESCENE', 'izna']);

  const texte = rendreSurveillées(liste);
  assert.match(texte, /- RESCENE — tour, repéré le 2026-09-10 \(Soompi\)/);
  assert.equal(rendreSurveillées(liste, { max: 1 }).split('\n').length, 1);
  assert.match(rendreSurveillées([]), /aucune sortie repérée/);
  assert.equal(MAX_SURVEILLÉES, 6);
});

test('le relevé additionne les flux et la veille, et un flux muet n est pas une panne de liste', async () => {
  const maintenant = new Date('2026-09-19T07:00:00+09:00');
  const flux = `<rss><channel><item><title>izna Announces Comeback Date</title><link>https://www.soompi.com/a</link><pubDate>Fri, 18 Sep 2026 22:00:00 +0000</pubDate></item></channel></rss>`;
  const veille = '- 2026-09-19T01:40:00+09:00 · 세븐틴, 10월 새 앨범 발매\n';

  const vivant = await relever({
    veille,
    jour: JOUR,
    maintenant,
    flux: [{ source_name: 'Soompi', url: 'https://www.soompi.com/feed' }],
    fetcher: async () => ({ ok: true, status: 200, text: async () => flux }),
  });
  assert.deepEqual(vivant.surveillées.map((e) => e.nom).sort(), ['izna', '세븐틴']);
  assert.deepEqual(vivant.pannes, []);

  // Flux en panne : la veille et la liste d'hier suffisent à faire une
  // consigne, et c'est exactement à quoi sert de la garder trois semaines.
  const muet = await relever({
    anciennes: [{ nom: 'RESCENE', signal: 'comeback', source: 'Soompi', vu: '2026-09-18', revu: '2026-09-18' }],
    veille,
    jour: JOUR,
    maintenant,
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(muet.pannes, ['Soompi : HTTP 503']);
  assert.deepEqual(muet.surveillées.map((e) => e.nom).sort(), ['RESCENE', '세븐틴']);
});

test('la consigne du volet coréen porte les noms, et ne laisse aucun gabarit vide', async () => {
  const méthode = await lire('prompts/recherche-methode-coreen.md');
  assert.ok(méthode.includes('{{ENTITES}}'), '{{ENTITES}} absent du volet coréen');
  assert.match(méthode, /Ces requêtes passent avant les thèmes/);

  const { composerConsigne } = await import('../scripts/lib/recherche.mjs');
  const consigne = composerConsigne(await lire('prompts/recherche-evenements.md'), {
    jour: JOUR,
    domaines: ['inven.co.kr'],
    officiels: ['thehyundai.com'],
    agrégateurs: ['popply.co.kr'],
    méthode,
    entités: rendreSurveillées([{ nom: '지수', signal: 'comeback', source: 'Soompi', vu: '2026-09-04' }]),
  });
  // {{ENTITES}} vit DANS le fichier de méthode : il ne se remplit que si la
  // substitution passe après {{METHODE}}, et rien d'autre ne le dirait.
  assert.match(consigne, /- 지수 — comeback, repéré le 2026-09-04 \(Soompi\)/);
  assert.ok(!consigne.includes('{{'), 'un gabarit est resté vide dans la consigne');
});
