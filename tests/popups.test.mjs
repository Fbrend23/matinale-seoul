// Le registre des pop-ups, testé sans réseau.
//
// Ce qui peut mentir en silence ici : une date reculée d'un jour par une
// conversion d'horaire (le registre écrit ses journées à minuit UTC) ; un
// pop-up neuf pris pour un doublon, donc écarté sans que rien ne le dise —
// c'est la panne même que ce script répare ; un thème deviné d'un mot croisé
// dans une description ; une fiche recopiée avec un résumé anglais.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adressesDeFiches,
  quartierRomanisé,
  événementDeFiche,
  thèmeProbable,
  genreProbable,
  signature,
  motsGénériques,
  déjàDansOnglet,
  fetcheurDeCache,
  récolter,
  rendreRegistre,
  parProximité,
  REGISTRE,
  REGISTRES,
  NOL_WORLD,
} from '../scripts/lib/popups.mjs';

const JOUR = '2026-09-19';

/** Une fiche du registre, telle qu'Inside Seoul la rend : du JSON-LD Event. */
const fiche = ({
  name,
  description = '',
  start = '2026-09-19',
  end = '2026-09-20',
  lieu = '서울 강남구 신사동 563-20 1층',
  adresse = null,
}) => `<!doctype html><html><head><title>${name}</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] })}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name,
  description,
  startDate: start ? `${start}T00:00:00.000Z` : undefined,
  endDate: end ? `${end}T00:00:00.000Z` : undefined,
  location: {
    '@type': 'Place',
    ...(lieu ? { name: lieu } : {}),
    address: { '@type': 'PostalAddress', streetAddress: adresse ?? lieu, addressLocality: 'Seoul', addressCountry: 'KR' },
    geo: { '@type': 'GeoCoordinates', latitude: 37.52, longitude: 127.02 },
  },
})}</script></head><body></body></html>`;

test('l\'index rend ses fiches, une fois chacune, et pas ses guides', () => {
  const index = `
    <a href="/popups">Tous</a>
    <a href="/guides/seoul-pop-up-store-guide">Guide</a>
    <a href="/gangnam/popups/dalsom-first-popup-sinsa">DALSOM</a>
    <a href="/seongsu/popups">Seongsu</a>
    {"href":"/gangnam/popups/dalsom-first-popup-sinsa"}
    {\\"href\\":\\"/hongdae/popups/kyoiii-fw-popup-hongdae\\"}
  `;
  assert.deepEqual(adressesDeFiches(index), [
    'https://insideseoul.app/gangnam/popups/dalsom-first-popup-sinsa',
    'https://insideseoul.app/hongdae/popups/kyoiii-fw-popup-hongdae',
  ]);
});

test('une fiche donne ses JOURS, son adresse en hangul et son quartier, et pas de résumé', () => {
  // Minuit UTC est le marqueur d'une journée à Séoul, pas une heure : une
  // conversion reculerait chaque date d'un jour, et l'événement d'un jour
  // unique finirait la veille de son ouverture.
  const url = 'https://insideseoul.app/gangnam/popups/dalsom-first-popup-sinsa';
  const { event, matière } = événementDeFiche(
    fiche({ name: 'DALSOM First Pop-up (Sinsa)', description: 'Korean label DALSOM, 25FW collection. 19 to 20 September 2026 only.' }),
    { url }
  );
  assert.equal(event.start_date, '2026-09-19');
  assert.equal(event.end_date, '2026-09-20');
  assert.equal(event.venue, '서울 강남구 신사동 563-20 1층');
  assert.equal(event.area, 'Gangnam');
  assert.equal(event.kind, 'popup');
  assert.equal(event.theme, 'mode');
  assert.equal(event.source_name, REGISTRE.nom);
  assert.equal(event.source_url, url);
  // Le résumé se rédige en français, à la rédaction : un résumé anglais
  // recopié serait un résumé que personne n'a écrit.
  assert.equal(event.summary, undefined);
  assert.match(matière, /^Korean label DALSOM/);

  // Sans Event lisible, pas de fiche : mieux vaut une fiche en moins qu'un
  // événement à moitié deviné. Mais le refus DIT lequel — « pas de JSON-LD » et
  // « pas de date de fin » ne se corrigent pas au même endroit, et vingt-deux
  // fiches de NOL World rangées sous le même message disaient le contraire de
  // la vérité.
  assert.equal(événementDeFiche('<html></html>', { url }).raison, 'pas de JSON-LD Event');
  assert.equal(événementDeFiche(fiche({ name: '' }), { url }).raison, 'fiche sans nom');
  // Et la règle se distingue de la panne : vingt fiches de NOL World sans date
  // de fin sont un fait du registre, que le journal compte, pas vingt pannes
  // qu'il crie une par une.
  const sansFin = événementDeFiche(fiche({ name: 'X', end: '' }), { url });
  assert.equal(sansFin.raison, 'sans date de fin annoncée');
  assert.equal(sansFin.règle, true);
  assert.equal(événementDeFiche('<html></html>', { url }).règle, undefined);
});

test('NOL World romanise tout : la table donne le hangul, l adresse sert de secours', () => {
  const url = 'https://world.nol.com/en/content/festas/019b8bbf-6a69-747b-84fe-249d219019ac';
  // Un lieu que la table connaît : l'événement tient debout tout seul.
  const connu = événementDeFiche(
    fiche({ name: 'Seoul Outdoor Library', lieu: 'Seoul Plaza', adresse: '12, Eulji-ro, Jung-gu,' }),
    { url, registre: NOL_WORLD }
  );
  assert.equal(connu.event.venue, '서울광장');
  assert.equal(connu.event.area, 'Jung');

  // Un lieu qu'elle ne connaît pas, ou pas de lieu du tout : l'adresse
  // romanisée passe en `venue`, la garde l'écartera « lieu sans hangul », et
  // c'est scripts/popups.mjs qui en fait une piste à compléter plutôt qu'une
  // perte. Huit des vingt-deux fiches datées de NOL n'ont aucun nom de lieu.
  const sansNom = événementDeFiche(
    fiche({ name: 'Shin Ramyun 40th Anniversary POP-UP', lieu: '', adresse: '52, Seongsuil-ro 4-gil, Seongdong-gu,' }),
    { url, registre: NOL_WORLD }
  );
  assert.equal(sansNom.event.venue, '52, Seongsuil-ro 4-gil, Seongdong-gu,');
  assert.equal(sansNom.event.area, 'Seongdong');
  assert.equal(sansNom.adresse, '52, Seongsuil-ro 4-gil, Seongdong-gu,');

  assert.equal(quartierRomanisé('108, Yeoui-daero, Yeongdeungpo-gu,'), 'Yeongdeungpo');
  assert.equal(quartierRomanisé(''), null);

  // Les deux registres se lisent pareil, et c'est tout l'intérêt : même
  // JSON-LD, deux listes qui ne se recouvrent pas.
  assert.deepEqual(REGISTRES.map((r) => r.hôte), ['insideseoul.app', 'world.nol.com']);
  assert.equal(REGISTRE, REGISTRES[0]);
});

test('le thème se propose des mots qui désignent, et l\'artiste ne compte que dans le titre', () => {
  // « sa-NCT-uary » : au premier essai, une description a classé un pop-up de
  // livres en kpop. Un nom d'artiste cité en passant n'est pas une affiche.
  assert.equal(thèmeProbable('Takao Mountain Book Pop-up', 'A bookshop pop-up beside a mountain sanctuary.'), 'culture');
  assert.equal(thèmeProbable('ATEEZ × LINE FRIENDS — MIGHTEEZ', 'Character goods'), 'kpop');
  assert.equal(thèmeProbable('Pokémon Pop-up: Pikachu\'s Autumn Outing'), 'pokemon');
  assert.equal(thèmeProbable('Blue Lock × Gratte Collab Cafe'), 'anime');
  assert.equal(thèmeProbable('oggitt × Sanrio characters Pop-up'), 'personnages');
  // Rien de sûr : le champ est omis, et la veille dit « thème à trancher ».
  assert.equal(thèmeProbable('Imported-Brand Stock Market at Storykan'), null);

  assert.equal(genreProbable('三國三美: Cosmetic Culture (Coreana Cosmetics Museum)'), 'exposition');
  assert.equal(genreProbable('Oktoberfest Seoul 2026'), 'festival');
  assert.equal(genreProbable('DALSOM First Pop-up'), 'popup');
});

test('le diff reconnaît la même fiche, puis la marque, et se tait sur un mot partagé', () => {
  const connus = [
    { name: 'Pop-up LE BOISÉ Fragrance au DDP', start_date: '2026-09-09', end_date: '2026-09-20', source_url: 'https://insideseoul.app/myeongdong/popups/le-boise-fragrance-popup-ddp' },
    { name: 'Pop-up de lancement Riftbound TCG', start_date: '2026-09-18', end_date: '2026-09-30', source_url: 'https://www.inven.co.kr/webzine/news/?news=1' },
    { name: 'ENHYPEN - House of Vampire', start_date: '2026-09-15', end_date: '2026-10-01', source_url: 'https://world.nol.com/1' },
    { name: 'Omniscient Reader : le café d\'animate', start_date: '2026-09-10', end_date: '2026-09-30', source_url: 'https://insideseoul.app/hongdae/popups/omniscient' },
    { name: 'Blue Lock × Gratte : les Cyber Cats chez animate', start_date: '2026-09-12', end_date: '2026-09-28', source_url: 'https://insideseoul.app/hongdae/popups/blue-lock' },
    { name: 'oggitt × Sanrio : pyjamas Pochacco et Pompompurin', start_date: '2026-09-01', end_date: '2026-09-30', source_url: 'https://insideseoul.app/seongsu/popups/oggitt-sanrio' },
    { name: 'Nongshim × Sanrio Characters K-Snack Tour', start_date: '2026-09-05', end_date: '2026-10-05', source_url: 'https://world.nol.com/2' },
  ];

  // La même fiche, à la barre finale près : le cas facile, exact.
  const même = { name: 'LE BOISÉ Fragrance Pop-up (DDP, Dongdaemun)', start_date: '2026-09-09', end_date: '2026-09-20', source_url: 'https://insideseoul.app/myeongdong/popups/le-boise-fragrance-popup-ddp/' };
  assert.equal(déjàDansOnglet(même, connus).preuve, 'même fiche');

  // L'onglet le tient d'une AUTRE source, sous un nom français : ni l'adresse,
  // ni la ressemblance de chaîne ne le voient. La marque, si.
  const autreSource = { name: 'Riftbound — League of Legends TCG Launch (Yongsan)', start_date: '2026-09-18', end_date: '2026-09-30', source_url: 'https://insideseoul.app/yongsan/popups/riftbound-launch' };
  assert.match(déjàDansOnglet(autreSource, connus).preuve, /riftbound/);

  // ET LE FAUX DOUBLON, QUI EST LA VRAIE PANNE : « house » est un décor,
  // « animate » nomme trois cafés de l'onglet. Un pop-up neuf qui les partage
  // reste neuf.
  const horreur = { name: 'Horror House: Endless Escape (MOFUN)', start_date: '2026-09-15', end_date: '2026-10-01', source_url: 'https://insideseoul.app/hongdae/popups/horror-house' };
  assert.equal(déjàDansOnglet(horreur, connus), null);
  const tamon = { name: 'Which Way, Tamon-kun?! × Gratte Collab Cafe (animate Hongdae)', start_date: '2026-09-19', end_date: '2026-11-01', source_url: 'https://insideseoul.app/hongdae/popups/tamon-kun' };
  assert.equal(déjàDansOnglet(tamon, connus), null);

  // La liste à la main ne prévoit pas tout : ce que DEUX événements de l'onglet
  // partagent cesse de les distinguer, et « Sanrio » est de ceux-là dès qu'il y
  // a deux collaborations en cours. Un troisième pop-up Sanrio reste donc neuf.
  const génériques = motsGénériques(connus);
  assert.ok(génériques.has('sanrio'));
  assert.ok(!génériques.has('riftbound'), 'la marque d\'un seul événement doit rester distinctive');
  const troisième = { name: 'Sanrio characters Pop-up (Times Square)', start_date: '2026-09-18', end_date: '2026-09-25', source_url: 'https://insideseoul.app/yeongdeungpo/popups/sanrio-times-square' };
  assert.equal(déjàDansOnglet(troisième, connus), null);

  // Les mêmes mots, mais des dates qui ne se touchent pas : deux éditions.
  const passé = { name: 'Riftbound — League of Legends TCG Launch', start_date: '2026-11-01', end_date: '2026-11-10', source_url: 'https://insideseoul.app/yongsan/popups/riftbound-2' };
  assert.equal(déjàDansOnglet(passé, connus), null);

  // Une année n'a jamais désigné un événement.
  assert.ok(!signature('Oktoberfest Seoul 2026').has('2026'));
});

test('la récolte lit l\'index puis les fiches, et nomme celle qui ne se lit pas', async () => {
  const pages = new Map([
    [REGISTRE.index, '<a href="/gangnam/popups/un">1</a><a href="/seongsu/popups/deux">2</a><a href="/mapo/popups/trois">3</a>'],
    ['https://insideseoul.app/gangnam/popups/un', fiche({ name: 'Pop-up BYREDO', description: 'Fragrance launch.' })],
    ['https://insideseoul.app/seongsu/popups/deux', fiche({ name: 'Pop-up TENMONTH', description: 'A gallery of everyday life.' })],
    ['https://insideseoul.app/mapo/popups/trois', '<html>rien</html>'],
  ]);
  const fetcher = async (url) => {
    const html = pages.get(String(url));
    if (html === undefined) return { ok: false, status: 404, url: String(url), text: async () => '' };
    return { ok: true, status: 200, url: String(url), text: async () => html };
  };

  const { candidats, fiches, pannes, vues } = await récolter({ fetcher, concurrence: 2 });
  assert.equal(fiches, 3);
  assert.deepEqual(candidats.map(({ event }) => event.name), ['Pop-up BYREDO', 'Pop-up TENMONTH']);
  assert.deepEqual(pannes.map(({ raison }) => raison), ['pas de JSON-LD Event']);

  // Le cache : les gardes sondent, et la page vient de la mémoire, pas du
  // réseau. Le verdict reste vrai, il est daté de la lecture.
  let appels = 0;
  const cache = fetcheurDeCache(vues, async (url) => {
    appels += 1;
    return { ok: true, status: 200, url: String(url), text: async () => '' };
  });
  const lue = await cache('https://insideseoul.app/gangnam/popups/un', { method: 'HEAD' });
  assert.equal(lue.status, 200);
  assert.equal(appels, 0);
  await cache('https://exemple.test/jamais-lue');
  assert.equal(appels, 1, 'une adresse jamais lue passe au vrai fetch');
});

test('la section met en avant les plus proches, garde le reste visible, et dit la panne', () => {
  const candidats = [
    { event: { name: 'Dans un mois', theme: 'mode', start_date: '2026-10-19', end_date: '2026-10-25', source_url: 'https://insideseoul.app/a/popups/1' }, matière: 'Later.' },
    { event: { name: 'Ce matin', theme: 'food', start_date: '2026-09-19', end_date: '2026-09-20', source_url: 'https://insideseoul.app/a/popups/2' }, matière: 'Today.' },
  ];
  assert.deepEqual(parProximité(candidats, JOUR).map(({ event }) => event.name), ['Ce matin', 'Dans un mois']);

  const section = rendreRegistre({
    candidats,
    fiches: 60,
    jour: JOUR,
    max: 1,
    écartées: [{ event: { name: 'Déjà là' }, raison: 'même fiche' }],
    àCompléter: [
      {
        event: { name: 'Shin Ramyun 40th', theme: 'food', start_date: '2026-09-19', end_date: '2026-11-30', venue: '52, Seongsuil-ro 4-gil, Seongdong-gu,', source_url: 'https://world.nol.com/en/content/festas/abc' },
        adresse: '52, Seongsuil-ro 4-gil, Seongdong-gu,',
      },
    ],
  });
  assert.match(section, /^## Pop-ups des registres \(Inside Seoul\)/);
  // Ce à quoi il ne manque que le lieu ne se perd pas en silence : il se
  // complète, et la veille dit comment.
  assert.match(section, /Il ne leur manque que le lieu en coréen/);
  assert.match(section, /- Shin Ramyun 40th · food · 2026-09-19 → 2026-11-30 · lieu « 52, Seongsuil-ro 4-gil, Seongdong-gu, » · https/);
  // Ce qui est mis en avant porte son JSON, sans résumé, avec sa matière.
  assert.match(section, /### Ce matin/);
  assert.match(section, /```json\n\{\n {2}"name": "Ce matin"/);
  assert.ok(!section.includes('"summary"'));
  assert.match(section, /Matière \(anglais, du registre\) : Today\./);
  // Le reste n'est pas caché : il tient une ligne, et reviendra demain.
  assert.match(section, /Le reste du registre, 1 fiches.*réénumère/s);
  assert.match(section, /- Dans un mois · 2026-10-19 → 2026-10-25/);
  assert.match(section, /Déjà là : même fiche/);

  // La panne ne se déguise pas en liste vide.
  assert.match(rendreRegistre({ jour: JOUR, panne: 'HTTP 503' }), /n'ont rien rendu \(HTTP 503\)/);
});
