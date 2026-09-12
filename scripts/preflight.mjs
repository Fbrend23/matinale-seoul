#!/usr/bin/env node
// Contrôle avant vol : applique au brief tout ce qui peut l'être hors de la CI.
//
//   node scripts/preflight.mjs inbox/brief-2026-09-07.json
//
// Écrit pour la routine qui rédige le brief : elle a le dépôt cloné, donc elle
// peut se relire avant de pousser au lieu de laisser la CI le lui apprendre.
// Un brief recalé en CI, c'est un run rouge, un mail, et une matinée sans brief.
// Un brief recalé ici, c'est une correction avant même le commit.
//
// LES CINQ GARDES, ET DANS LEUR ORDRE. Les doublons se jugeaient autrefois dans
// la seule CI, faute d'accès au CMS — si bien que l'agent pouvait pousser un
// brief dont des items seraient retirés en silence, sans jamais l'apprendre. Or
// le site publie « /api/recent.json », qui porte les mêmes titres et que le
// prompt lui fait déjà lire. Ce contrôle s'en sert.
//
// La CI reste juge. Ce fichier ne fait que devancer son verdict, et il le
// devance d'un cheveu du bon côté : recent.json sert les quatorze derniers
// BRIEFS quand le CMS compte quatorze JOURS, donc la fenêtre est un peu plus
// large ici. Mieux vaut un avertissement de trop qu'un item perdu sans un mot.
//
// Code de sortie : 0 si le brief passerait, 1 sinon.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  validateSchema,
  checkLinks,
  checkAllowlist,
  findDuplicates,
  checkCoherence,
  flatten,
  unflatten,
  seoulDate,
} from './lib/guards.mjs';
import { contrôlerÉvénements } from './lib/evenements.mjs';

const RACINE = path.join(import.meta.dirname, '..');

// Le site qui sert recent.json. La variable permet de viser une préproduction ;
// le défaut est l'adresse que le prompt donne déjà à l'agent.
const SITE = (process.env.SITE_URL ?? 'https://matinale.brendanfleurdelys.ch').replace(/\/$/, '');

const fichier = process.argv[2];

if (!fichier) {
  console.error('Usage : node scripts/preflight.mjs <inbox/brief-AAAA-MM-JJ.json>');
  process.exit(1);
}

/**
 * Les titres déjà couverts AVANT le jour du brief, tels que le site les publie.
 *
 * Le filtre sur la date n'est pas une précaution : c'est la même règle que côté
 * CMS, où recentHeadlines() lit strictement « avant aujourd'hui ». Sans lui, un
 * brief déjà publié — ou rejoué après un premier passage — se reconnaîtrait
 * lui-même à 1.00 et verrait tous ses items marqués comme doublons. Vu au
 * premier essai, sur un brief de l'archive.
 *
 * Rend `null` — et non un tableau vide — quand le fichier est hors d'atteinte :
 * « je n'ai pas pu regarder » et « il n'y a rien » ne se disent pas de la même
 * façon, et seul le premier mérite d'être signalé à l'agent.
 */
async function titresDéjàCouverts(avant, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${SITE}/api/recent.json`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const charge = await res.json();
    return (charge?.briefs ?? [])
      .filter((b) => b.date < avant)
      .flatMap((b) => (b.headlines ?? []).map((h) => h.headline));
  } catch (e) {
    const raison = e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message;
    console.log(`! doublons      recent.json injoignable (${raison})`);
    console.log('                cette garde est sautée ; la CI la jouera, elle.');
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Les événements que le site connaît déjà, en cours ou à venir.
 *
 * Même règle que titresDéjàCouverts() : `null` quand le fichier est hors
 * d'atteinte, parce que « je n'ai pas pu regarder » n'est pas « il n'y a rien ».
 */
async function événementsDéjàConnus({ timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${SITE}/api/evenements.json`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const charge = await res.json();
    return charge?.events ?? [];
  } catch (e) {
    const raison = e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message;
    console.log(`! événements    evenements.json injoignable (${raison})`);
    console.log('                les doublons d événements ne sont pas jugés ; la CI le fera.');
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

const nom = path.basename(fichier);
const nommage = /^brief-(\d{4}-\d{2}-\d{2})\.json$/.exec(nom);
const problemes = [];

console.log(`Contrôle avant vol — ${nom}\n`);

if (!nommage) {
  problemes.push(`nom de fichier hors format : attendu brief-AAAA-MM-JJ.json`);
}

let brief;
try {
  brief = JSON.parse(await readFile(fichier, 'utf8'));
} catch (e) {
  console.error(`JSON illisible : ${e.message}`);
  process.exit(1);
}

if (nommage && brief.date !== nommage[1]) {
  problemes.push(`le nom dit ${nommage[1]} et le contenu ${brief.date}`);
}

// --- Garde 1 : schéma ---
const schema = JSON.parse(await readFile(path.join(RACINE, 'schemas', 'brief.schema.json'), 'utf8'));
const fautes = validateSchema(brief, schema);
if (fautes.length) {
  problemes.push(...fautes.map((f) => `schéma : ${f}`));
  console.log(`✗ schéma        ${fautes.length} faute(s)`);
} else {
  console.log('✓ schéma');
}

// Sans schéma valide, le reste porterait sur une structure incertaine.
if (!fautes.length) {
  const items = flatten(brief);

  // --- Garde 2 : liens vivants ---
  // Seul le verdict « mort » recale. Un accès refusé est signalé — il explique
  // qu'un item paraîtra sans date de vérification — mais ne bloque pas le
  // départ : l'ingestion ne le bloquera pas non plus.
  const sondes = await checkLinks(items);

  const morts = sondes.filter((s) => s.verdict === 'mort');
  for (const mort of morts) {
    problemes.push(`lien mort : ${mort.item.source_url} (${mort.reason})`);
  }
  console.log(
    morts.length
      ? `✗ liens         ${morts.length} mort(s) sur ${items.length}`
      : `✓ liens         ${items.length - morts.length} joignables`
  );

  const refusés = sondes.filter((s) => s.verdict === 'refusé');
  for (const refus of refusés) {
    console.log(`! accès refusé  ${refus.item.source_url} (${refus.reason})`);
    console.log("                l'item est conservé : un refus ne prouve pas que");
    console.log("                la page est inventée, seulement qu'on ne l'a pas vue.");
  }

  const vivants = sondes.filter((s) => s.ok).map((s) => s.item);

  // --- Garde 3 : allowlist (avertissement, pas faute) ---
  const { domains } = JSON.parse(await readFile(path.join(RACINE, 'config', 'sources.json'), 'utf8'));
  const inconnus = checkAllowlist(vivants, domains);
  if (inconnus.length) {
    const hôtes = [...new Set(inconnus.map((i) => i.host))];
    console.log(`! allowlist     ${hôtes.join(', ')}`);
    console.log('                le brief serait ingéré mais RETENU EN BROUILLON,');
    console.log('                donc invisible sur le site jusqu à relecture.');
  } else {
    console.log('✓ allowlist');
  }

  // --- Garde 4 : doublons ---
  // Retirer un item ne recale pas le brief : c'est un avertissement, comme
  // l'allowlist. Mais l'agent doit le savoir avant de pousser, sans quoi son
  // brief maigrira en silence entre son commit et la mise en ligne.
  const anciens = await titresDéjàCouverts(brief.date);
  const doublons = anciens ? findDuplicates(vivants, anciens) : [];

  if (anciens) {
    for (const doublon of doublons) {
      console.log(`! déjà couvert  « ${doublon.item.headline.slice(0, 58)} »`);
      console.log(`                ressemble à ${doublon.score.toFixed(2)} à « ${doublon.against.slice(0, 48)} »`);
      console.log("                l'item serait RETIRÉ du brief à l'ingestion.");
    }
    if (!doublons.length) {
      console.log(`✓ doublons      aucun, sur ${anciens.length} titres déjà publiés`);
    }
  }

  // --- Garde 5 : cohérence, sur ce qui resterait vraiment ---
  //
  // L'ingestion juge après avoir retiré les liens morts ET les doublons : juger
  // ici sur le brief entier donnerait un verdict que la CI contredirait. D'où la
  // MÊME reconstruction qu'elle, et non une qui lui ressemble — ce contrôle n'a
  // de valeur que s'il prédit exactement son verdict.
  const retenus = vivants.filter((i) => !doublons.some((d) => d.item === i));
  const incoherences = checkCoherence(unflatten(brief, retenus), { today: seoulDate() });
  if (incoherences.length) {
    problemes.push(...incoherences.map((i) => `cohérence : ${i}`));
    console.log(`✗ cohérence     ${incoherences.length} problème(s)`);
  } else {
    console.log('✓ cohérence');
  }

  // --- Événements : des avertissements, jamais une faute ---
  //
  // L'ingestion écarte, elle ne recale pas. Mais l'agent doit savoir AVANT de
  // pousser qu'un événement partirait à la trappe — sans quoi l'onglet
  // maigrirait en silence, et lui croirait l'avoir garni.
  const événements = brief.events ?? [];
  if (événements.length) {
    const connus = await événementsDéjàConnus();
    const { retenus, écartés, liensRetirés, prolongés } = await contrôlerÉvénements(événements, {
      domaines: domains,
      connus: connus ?? [],
      today: seoulDate(),
    });

    for (const { event, raison } of écartés) {
      console.log(`! événement     « ${event.name.slice(0, 58)} »`);
      console.log(`                serait ÉCARTÉ à l'ingestion : ${raison}`);
    }
    for (const { event, champ, raison } of liensRetirés) {
      console.log(`! événement     ${champ} de « ${event.name.slice(0, 44)} » serait retiré (${raison})`);
    }
    for (const { event, connu } of prolongés) {
      console.log(`· événement     « ${event.name.slice(0, 58)} » est déjà connu :`);
      console.log(`                ses dates seraient mises à jour (${connu.end_date} → ${event.end_date}).`);
    }
    console.log(
      `${écartés.length ? '!' : '✓'} événements    ${retenus.length} retenu(s), ${prolongés.length} mis à jour, ` +
        `sur ${événements.length}`
    );
  }
}

console.log('');

if (problemes.length) {
  console.error('Ce brief serait recalé :\n');
  for (const p of problemes) console.error('  · ' + p);
  console.error('\nCorriger avant de committer.');
  process.exitCode = 1;
} else {
  console.log('Ce brief passerait les gardes.');
}
