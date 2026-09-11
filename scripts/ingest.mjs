#!/usr/bin/env node
// Ingestion d'un brief déposé dans inbox/.
//
//   node scripts/ingest.mjs inbox/brief-2026-09-04.json
//   node scripts/ingest.mjs                 # tous les brief-*.json de inbox/
//
// Les cinq gardes remplacent la relecture humaine, et leur ORDRE compte : la
// cohérence se juge sur ce qui reste une fois les items morts et les doublons
// retirés, pas sur ce que l'agent a écrit.
//
// Codes de sortie :
//   0  brief publié, ou déjà publié (rien à faire), ou inbox vide
//   1  brief recalé — le workflow échoue, GitHub envoie le mail, et le fichier
//      reste dans inbox/ pour être rejoué une fois la cause comprise

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  validateSchema,
  checkLinks,
  checkAllowlist,
  findDuplicates,
  checkCoherence,
  flatten,
  seoulDate,
} from './lib/guards.mjs';
import { createClient, briefForDate, recentHeadlines, saveBrief } from './lib/directus.mjs';
import { relevéMétéo } from './lib/meteo.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const INBOX = path.join(RACINE, 'inbox');
const NOM_ATTENDU = /^brief-(\d{4}-\d{2}-\d{2})\.json$/;

const journal = [];
const dire = (ligne) => {
  journal.push(ligne);
  console.log(ligne);
};

/** Fichiers à traiter : celui qu'on nous donne, ou tout ce que l'inbox contient. */
async function àTraiter() {
  const donné = process.argv[2];
  if (donné) return [path.resolve(donné)];

  const entrées = await readdir(INBOX).catch(() => []);
  return entrées
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(INBOX, f));
}

async function ingérer(fichier, client, aujourdhui) {
  const nom = path.basename(fichier);
  dire(`\n── ${nom}`);

  // Le nom du fichier est la première chose vérifiée : il est écrit par un
  // agent, et c'est lui qui dit de quel jour on parle.
  const nommage = NOM_ATTENDU.exec(nom);
  if (!nommage) {
    return { statut: 'recalé', raison: `nom de fichier hors format brief-YYYY-MM-DD.json : ${nom}` };
  }

  let brief;
  try {
    brief = JSON.parse(await readFile(fichier, 'utf8'));
  } catch (e) {
    return { statut: 'recalé', raison: `JSON illisible : ${e.message}` };
  }

  if (brief.date !== nommage[1]) {
    return {
      statut: 'recalé',
      raison: `le fichier dit ${nommage[1]} et le contenu ${brief.date} : impossible de trancher`,
    };
  }

  // --- Garde 1 : schéma ---
  const schéma = JSON.parse(
    await readFile(path.join(RACINE, 'schemas', 'brief.schema.json'), 'utf8')
  );
  const fautes = validateSchema(brief, schéma);
  if (fautes.length) {
    return { statut: 'recalé', brief, raison: `schéma : ${fautes.slice(0, 5).join(' ; ')}` };
  }
  dire('   garde 1 · schéma : conforme');

  // Idempotence, avant toute écriture comme avant tout appel réseau : si le
  // brief du jour est déjà en ligne, il n'y a rien à faire et rien à signaler.
  const déjà = await briefForDate(client, brief.date);
  if (déjà?.status === 'published') {
    dire(`   déjà publié (brief ${déjà.id}) : rien à écrire`);
    return { statut: 'déjà publié' };
  }

  const items = flatten(brief);

  // --- Garde 2 : liens vivants ---
  const sondes = await checkLinks(items);
  const morts = sondes.filter((s) => !s.ok);
  for (const mort of morts) {
    dire(`   garde 2 · lien mort, item retiré : ${mort.item.source_url} (${mort.reason})`);
  }
  const vivants = sondes
    .filter((s) => s.ok)
    .map((s) => ({ ...s.item, link_checked_at: s.checkedAt }));
  dire(`   garde 2 · liens : ${vivants.length} vivants, ${morts.length} morts`);

  // --- Garde 3 : allowlist ---
  const { domains } = JSON.parse(
    await readFile(path.join(RACINE, 'config', 'sources.json'), 'utf8')
  );
  const inconnus = checkAllowlist(vivants, domains);
  for (const inconnu of inconnus) {
    dire(`   garde 3 · domaine inconnu, brief retenu en brouillon : ${inconnu.host}`);
  }

  // --- Garde 4 : doublons ---
  const anciens = await recentHeadlines(client, { today: brief.date });
  const doublons = findDuplicates(vivants, anciens);
  for (const doublon of doublons) {
    dire(
      `   garde 4 · déjà couvert (${doublon.score.toFixed(2)}), item retiré : ` +
        `« ${doublon.item.headline.slice(0, 70)} »`
    );
  }
  const retenus = vivants.filter((i) => !doublons.some((d) => d.item === i));
  dire(`   garde 4 · ${retenus.length} items retenus sur ${items.length} proposés`);

  // --- Garde 5 : cohérence, sur ce qui reste ---
  const restant = {
    ...brief,
    sections: brief.sections.map((s) => ({
      ...s,
      items: retenus.filter((i) => i.section === s.key),
    })),
  };
  const incohérences = checkCoherence(restant, { today: aujourdhui });
  if (incohérences.length) {
    return { statut: 'recalé', brief, raison: `cohérence : ${incohérences.join(' ; ')}` };
  }
  dire('   garde 5 · cohérence : rien à redire');

  // --- Bulletin météo ---
  // Ce n'est PAS une sixième garde, et la place le dit : la météo n'a rien à
  // recaler. C'est un accessoire du brief, et un service tiers muet fait
  // disparaître le bloc sans jamais retenir l'actualité. L'échec se lit au
  // journal du run, jamais dans un brief manquant.
  //
  // Après les gardes, donc : un brief recalé sort plus haut, et n'a pas à
  // payer un appel réseau pour un bloc qui ne paraîtra pas.
  let météo = null;
  try {
    météo = await relevéMétéo({ date: brief.date });
    dire(`   météo · ${météo.tmin} à ${météo.tmax} °C, code WMO ${météo.code}`);
  } catch (e) {
    dire(`   météo · indisponible, le brief part sans son bloc : ${e.message}`);
    // Annotation dans le résumé du run : l'absence se voit sans que le job
    // passe au rouge. Un encadré manquant n'est pas une panne de publication.
    console.log(`::warning::Météo absente du brief ${brief.date} : ${e.message}`);
  }

  // --- Écriture ---
  const statut = inconnus.length ? 'draft' : 'published';
  const id = await saveBrief(client, {
    brief,
    items: retenus,
    status: statut,
    weather: météo,
    ingestStatus: 'ok',
    failureReason: inconnus.length
      ? `Domaines absents de config/sources.json : ${[...new Set(inconnus.map((i) => i.host))].join(', ')}. ` +
        `Le brief attend une relecture : ajouter les domaines s'ils sont légitimes, puis republier.`
      : null,
  });

  dire(`   écrit : brief ${id}, ${retenus.length} items, statut « ${statut} »`);
  return { statut: statut === 'published' ? 'publié' : 'brouillon', id };
}

// --- Programme ---------------------------------------------------------------

const fichiers = await àTraiter();

if (!fichiers.length) {
  // L'inbox vide est le cas NORMAL : la chaîne ne tourne qu'une fois par jour.
  console.log('inbox vide, rien à ingérer.');
  process.exit(0);
}

const client = createClient({
  url: process.env.DIRECTUS_URL,
  token: process.env.DIRECTUS_TOKEN,
});
const aujourdhui = seoulDate();
console.log(`Ingestion — ${fichiers.length} fichier(s), ${aujourdhui} à Séoul`);

let échec = false;

for (const fichier of fichiers) {
  let issue;
  try {
    issue = await ingérer(fichier, client, aujourdhui);
  } catch (e) {
    issue = { statut: 'recalé', raison: `erreur pendant l'ingestion : ${e.message}` };
  }

  if (issue.statut !== 'recalé') continue;

  échec = true;
  dire(`   RECALÉ — ${issue.raison}`);

  // Un brief recalé est tout de même écrit, en brouillon : c'est la seule
  // trace durable de son passage. Sans elle, un échec ne laisserait que des
  // logs de CI, qui expirent. L'écriture ne doit pas masquer la cause
  // première, d'où le catch qui se contente d'un avertissement.
  if (issue.brief) {
    try {
      await saveBrief(client, {
        brief: issue.brief,
        items: [],
        status: 'draft',
        ingestStatus: 'failed',
        failureReason: issue.raison,
      });
      dire('   trace écrite dans le CMS (brouillon, ingest_status = failed)');
    } catch (e) {
      console.warn(`   (trace non écrite : ${e.message})`);
    }
  }
}

if (échec) {
  console.error('\nAu moins un brief a été recalé. Le fichier reste dans inbox/ pour rejeu.');
  process.exitCode = 1;
} else {
  console.log('\nIngestion terminée.');
}
