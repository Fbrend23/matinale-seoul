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
    ['index.html', ['class="meteo"', 'class="change"', 'aria-current="page"', 'class="brief"']],
    // Deux mois dans la fixture : la barre d'ancres doit sortir, et pointer
    // sur des sections qui existent.
    ['briefs/index.html', ['class="mois"', 'class="mois-nav"', 'href="#mois-2026-08"', 'id="mois-2026-08"', 'id="mois-2026-09"']],
    ['briefs/brief-2026-08-28/index.html', ['class="brief"']],
    ['briefs/brief-2026-09-04/index.html', ['application/ld+json', 'class="meteo"']],
    // Une rubrique a le cadre de l'accueil : le contexte du jour à côté, une
    // tête de page, et où aller ensuite.
    ['sections/tourisme/index.html', ['class="item"', 'class="meteo"', 'class="change"', 'class="tete"', 'class="jour-bloc"', 'Autres rubriques']],
    // La dernière rubrique ajoutée : sa page doit sortir, même sans item.
    ['sections/sport/index.html', ['class="tete"', 'Autres rubriques']],
    // L'adresse est posée sur la carte d'événement pour la carte Kakao ; le
    // bloc carte, lui, n'existe pas sans clé, et ce contrôle n'en a pas.
    ['evenements/index.html', ['id="en-ce-moment"', 'class="filtres"', 'id="tri"', 'id="evenement-1"', 'class="delai"', 'map.naver.com/p/search/', 'data-adresse="서울 성동구 아차산로 7"']],
    ['evenements.xml', ['<item>', '/evenements/#evenement-']],
    ['rss.xml', ['<item>', '/briefs/brief-2026-09-04/']],
    ['api/recent.json', ['"headlines"']],
    ['api/evenements.json', ['"events"']],
    ['build.json', []],
    ['sitemap-index.xml', []],
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

  // Les JSON sont du JSON.
  for (const fichier of ['api/recent.json', 'api/evenements.json', 'build.json']) {
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
