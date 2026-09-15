#!/usr/bin/env node
// Contrôle de rendu : le site se construit-il encore, et chaque page sort-elle ?
//
//   npm run rendu
//
// Construit le site contre un CMS de pacotille (scripts/lib/faux-cms.mjs),
// puis vérifie que ce qu'on attend est bien là, chaque page, chaque flux,
// chaque JSON, et dedans ce qui prouve que le gabarit a fait son travail. Ni
// capture d'écran ni navigateur : un test qui demande un navigateur ne tourne
// plus, et celui-ci doit tourner à chaque commit.
//
// Ce que ça attrape : un import cassé dans une page, un composant qui lève,
// un champ renommé dans content.js et oublié dans un gabarit. Ce que ça
// n'attrape pas : un rendu laid. Pour cela, il y a les yeux.
//
// Code de sortie : 0 si tout sort, 1 sinon.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { donnéesDeDémonstration, démarrerLeFauxCms } from './lib/faux-cms.mjs';
import { slugLieu } from '../src/lib/lieux.js';

const RACINE = path.join(import.meta.dirname, '..');
const FIXTURE = path.join(RACINE, 'tests', 'fixtures', 'brief-avec-evenements.json');

const faux = await démarrerLeFauxCms(await donnéesDeDémonstration(FIXTURE));
const dist = await mkdtemp(path.join(tmpdir(), 'matinale-rendu-'));

console.log(`Contrôle de rendu : faux CMS sur ${faux.url}, sortie dans ${dist}\n`);

// --- Le build ----------------------------------------------------------------

const code = await new Promise((résoudre) => {
  // Le binaire d'Astro par node directement, et non par npx : pas de shell,
  // donc pas d'arguments à échapper, sur Windows comme sur le runner.
  const astro = path.join(RACINE, 'node_modules', 'astro', 'bin', 'astro.mjs');
  const enfant = spawn(process.execPath, [astro, 'build', '--outDir', dist], {
    cwd: RACINE,
    // Un jeton quelconque : le faux CMS ne le lit pas. L'adresse du site est
    // celle des flux et du sitemap, qui la portent en clair.
    env: { ...process.env, DIRECTUS_URL: faux.url, DIRECTUS_TOKEN: 'faux', SITE_URL: 'https://matinale.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = '';
  enfant.stdout.on('data', (d) => (sortie += d));
  enfant.stderr.on('data', (d) => (sortie += d));
  enfant.on('close', (c) => {
    if (c !== 0) console.error(sortie);
    résoudre(c ?? 1);
  });
});

await faux.fermer();

const problèmes = [];

if (code !== 0) {
  problèmes.push(`astro build est sorti en ${code}`);
} else {
  // --- Ce qui doit être là, et ce qu'on doit y lire -------------------------
  //
  // Chaque attente est une chose que le gabarit DÉCIDE, pas un mot du contenu,
  // qui vient de la fixture et changerait avec elle.
  const attendus = [
    // 42 µg/m³ de PM2,5 dans la fixture : « mauvais » selon AirKorea.
    ['index.html', ['class="meteo"', 'class="meteo-air"', 'data-air="mauvais"', 'class="change"', 'class="mot"', 'aria-current="page"', 'class="brief"']],
    // Le cahier des mots : une fiche par jour, la date liée à son brief.
    ['vocabulaire/index.html', ['class="mot-liste"', 'id="mot-2026-09-04"', 'href="/briefs/brief-2026-09-04/"', 'lang="ko"']],
    // Deux mois dans la fixture : la barre d'ancres doit sortir, et pointer
    // sur des sections qui existent.
    // Le cadre des pages de lecture, météo et change à côté : sans lui,
    // l'en-tête rétrécit d'un onglet à l'autre. Idem pour la recherche.
    ['briefs/index.html', ['class="mois"', 'class="mois-nav"', 'href="#mois-2026-08"', 'id="mois-2026-08"', 'id="mois-2026-09"', 'class="meteo"', 'class="change"']],
    ['briefs/brief-2026-08-28/index.html', ['class="brief"']],
    // Le brief est indexé à son adresse d'archive, et là seulement. Le
    // deuxième item de la fixture porte link_dead_at : sa source sort sans
    // lien, et le dit. Un autre porte son titre original : il sort sous le
    // titre, dans sa langue.
    ['briefs/brief-2026-09-04/index.html', ['application/ld+json', 'class="meteo"', 'data-pagefind-body', 'class="source-morte"', 'page retirée', 'class="titre-original" lang="']],
    // Une rubrique a le cadre de l'accueil : le contexte du jour à côté, une
    // tête de page, et où aller ensuite.
    ['sections/tourisme/index.html', ['class="item"', 'class="meteo"', 'class="change"', 'class="tete"', 'class="jour-bloc"', 'Autres rubriques']],
    // La dernière rubrique ajoutée : sa page doit sortir, même sans item.
    ['sections/sport/index.html', ['class="tete"', 'Autres rubriques']],
    // L'adresse est posée sur la carte d'événement pour la carte Kakao ; le
    // bloc carte, lui, n'existe pas sans clé, et ce contrôle n'en a pas.
    ['evenements/index.html', ['id="en-ce-moment"', 'class="filtres"', 'id="tri"', 'id="evenement-1"', 'class="delai"', 'data-urgent="oui"', 'map.naver.com/p/search/', 'data-adresse="서울 성동구 아차산로 7"']],
    // Le lieu partagé par deux événements a sa page, avec ses deux cartes, et
    // les cartes de la page Événements y mènent ; le lieu d'un seul événement
    // n'en a pas, et sa carte ne lie rien.
    [`lieux/${slugLieu('KSPO돔')}/index.html`, ['class="tete"', 'lang="ko"', 'id="evenement-3"', 'id="evenement-4"', 'map.naver.com/p/search/']],
    ['evenements.xml', ['<item>', '/evenements/#evenement-']],
    ['rss.xml', ['<item>', '/briefs/brief-2026-09-04/']],
    ['api/recent.json', ['"headlines"']],
    ['api/evenements.json', ['"events"']],
    ['build.json', []],
    ['sitemap-index.xml', []],
    // La recherche : la page, et l'index que l'intégration écrit après le
    // build, dans CE dossier de sortie et pas un autre.
    ['recherche/index.html', ['id="recherche"', '/pagefind/pagefind-ui.js', 'class="meteo"', 'class="change"']],
    ['pagefind/pagefind-ui.js', []],
    ['pagefind/pagefind-entry.json', []],
  ];

  for (const [fichier, marques] of attendus) {
    let texte;
    try {
      texte = await readFile(path.join(dist, fichier), 'utf8');
    } catch {
      problèmes.push(`${fichier} : absent`);
      console.log(`✗ ${fichier}`);
      continue;
    }

    const manquantes = marques.filter((m) => !texte.includes(m));
    for (const m of manquantes) problèmes.push(`${fichier} : « ${m} » introuvable`);
    console.log(`${manquantes.length ? '✗' : '✓'} ${fichier}`);
  }

  // Le terminé ne doit paraître nulle part : ni sur la page, ni dans le flux,
  // ni dans ce que l'agent lit.
  for (const fichier of ['evenements/index.html', 'evenements.xml', 'api/evenements.json']) {
    const texte = await readFile(path.join(dist, fichier), 'utf8').catch(() => '');
    if (texte.includes('Terminé, ne doit pas paraître')) {
      problèmes.push(`${fichier} : un événement terminé y paraît`);
    }
  }

  // Sans clé, la page n'a ni bloc carte ni SDK Kakao : un site sans compte
  // Kakao reste un site, et n'appelle personne.
  {
    const texte = await readFile(path.join(dist, 'evenements/index.html'), 'utf8').catch(() => '');
    for (const m of ['id="sur-la-carte"', 'dapi.kakao.com']) {
      if (texte.includes(m)) problèmes.push(`evenements/index.html : « ${m} » présent sans KAKAO_MAPS_APP_KEY`);
    }
  }

  {
    const texte = await readFile(path.join(dist, 'evenements/index.html'), 'utf8').catch(() => '');
    if (!texte.includes(`href="/lieux/${slugLieu('KSPO돔')}/"`)) problèmes.push('evenements/index.html : le lieu partagé ne mène pas à sa page');
    if (texte.includes(`href="/lieux/${slugLieu('더현대 서울')}/"`)) problèmes.push('evenements/index.html : un lieu à un seul événement porte un lien');
  }

  // L'accueil rend le même brief : il ne doit pas être indexé une seconde fois.
  {
    const texte = await readFile(path.join(dist, 'index.html'), 'utf8').catch(() => '');
    if (texte.includes('data-pagefind-body')) problèmes.push('index.html : data-pagefind-body présent, le brief du jour serait indexé deux fois');
  }

  // Les JSON sont du JSON.
  for (const fichier of ['api/recent.json', 'api/evenements.json', 'build.json', 'pagefind/pagefind-entry.json']) {
    try {
      JSON.parse(await readFile(path.join(dist, fichier), 'utf8'));
    } catch (e) {
      problèmes.push(`${fichier} : JSON illisible (${e.message})`);
    }
  }
}

await rm(dist, { recursive: true, force: true });

console.log('');
if (problèmes.length) {
  console.error('Le site ne sort pas comme attendu :\n');
  for (const p of problèmes) console.error('  · ' + p);
  process.exitCode = 1;
} else {
  console.log('Le site sort entier.');
}
