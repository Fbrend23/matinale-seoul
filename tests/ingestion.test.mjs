// L'orchestration de l'ingestion : l'ordre des gardes, et ce qu'on décide.
//
// Chaque garde avait ses tests ; leur ENCHAÎNEMENT n'en avait aucun. Or c'est
// lui qui porte les décisions du dépôt : la cohérence se juge sur ce qui reste
// et non sur ce que l'agent a proposé, un domaine inconnu retient le brief en
// brouillon sans rien jeter, un brief déjà publié n'est pas réécrit, et la
// météo ne recale jamais rien.
//
// Aucun de ces choix ne se voit dans une garde prise isolément. Intervertir
// deux d'entre elles changerait le verdict sans faire rougir un seul test
// unitaire — c'est précisément ce que ce fichier garde.
//
// Rien ne touche au réseau : le client CMS et le relevé météo sont injectés.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ingérer, tracerLÉchec } from '../scripts/lib/ingestion.mjs';

const RACINE = path.join(import.meta.dirname, '..');
const lireJSON = async (...b) => JSON.parse(await readFile(path.join(RACINE, ...b), 'utf8'));

const schéma = await lireJSON('schemas', 'brief.schema.json');
const { domains: domaines } = await lireJSON('config', 'sources.json');
const VALIDE = await lireJSON('tests', 'fixtures', 'brief-valide.json');

const JOUR = VALIDE.date;
const NOM = `brief-${JOUR}.json`;

/** Le brief de référence, éventuellement retouché. */
const brief = (retouche = (b) => b) => retouche(structuredClone(VALIDE));

const bulletin = { date: JOUR, tmin: 18, tmax: 26, code: 1 };

/**
 * Client CMS factice.
 *
 * `publié` fait répondre « ce jour est déjà en ligne » ; `anciens` fournit les
 * titres des quatorze derniers jours que lit la garde des doublons.
 */
function fauxClient({ publié = false, anciens = [] } = {}) {
  const écritures = [];

  return {
    écritures,
    get: async (chemin) => {
      if (chemin.includes('mat_briefs?filter')) {
        return publié ? [{ id: 42, status: 'published' }] : [];
      }
      if (chemin.includes('mat_news_items?fields=headline')) {
        return anciens.map((headline) => ({ headline }));
      }
      return [];
    },
    post: async (chemin, corps) => {
      écritures.push({ verbe: 'post', chemin, corps: structuredClone(corps) });
      return { id: 7 };
    },
    patch: async (chemin, corps) => {
      écritures.push({ verbe: 'patch', chemin, corps: structuredClone(corps) });
      return null;
    },
  };
}

/** Toutes les URL répondent 200, sauf celles qu'on désigne autrement. */
const sondeur = (parURL = {}) => {
  globalThis.fetch = async (url) => {
    const statut = parURL[url] ?? 200;
    return { ok: statut >= 200 && statut < 300, status: statut };
  };
};

/** Lance l'ingestion avec des dépendances saines par défaut. */
const lancer = ({ client, texte, nom = NOM, relevé = async () => bulletin, aujourdhui = JOUR } = {}) =>
  ingérer({
    nom,
    texte: texte ?? JSON.stringify(VALIDE),
    client: client ?? fauxClient(),
    aujourdhui,
    schéma,
    domaines,
    relevé,
  });

/** Le brief écrit dans le CMS, s'il l'a été. */
const briefÉcrit = (client) =>
  client.écritures.find((e) => e.chemin.includes('mat_briefs') && !Array.isArray(e.corps))?.corps;

/** Les items écrits, à plat. */
const itemsÉcrits = (client) =>
  client.écritures.filter((e) => e.chemin.includes('mat_news_items')).flatMap((e) => e.corps);

// --- Le chemin nominal -------------------------------------------------------

test('un brief sain est publié, avec tous ses items', async () => {
  sondeur();
  const client = fauxClient();
  const issue = await lancer({ client });

  assert.equal(issue.statut, 'publié');
  assert.equal(briefÉcrit(client).status, 'published');
  assert.equal(itemsÉcrits(client).length, 6);
});

test('le bulletin météo part avec le brief', async () => {
  sondeur();
  const client = fauxClient();
  await lancer({ client });

  assert.deepEqual(briefÉcrit(client).weather, bulletin);
});

// --- Ce qui recale avant même la première garde ------------------------------

test('un nom de fichier hors format recale, sans rien écrire', async () => {
  sondeur();
  const client = fauxClient();
  const issue = await lancer({ client, nom: 'brief-du-jour.json' });

  assert.equal(issue.statut, 'recalé');
  assert.match(issue.raison, /hors format/);
  assert.equal(client.écritures.length, 0);
});

test('un JSON illisible recale, et ne laisse aucune trace à écrire', async () => {
  sondeur();
  const issue = await lancer({ texte: '{ ceci n est pas du JSON' });

  assert.equal(issue.statut, 'recalé');
  assert.match(issue.raison, /JSON illisible/);
  assert.equal(issue.brief, undefined, "on ne peut pas tracer un brief qu'on n'a pas pu lire");
});

test('un nom et un contenu qui se contredisent recalent : on ne tranche pas', async () => {
  sondeur();
  const issue = await lancer({ nom: 'brief-2026-09-05.json' });

  assert.equal(issue.statut, 'recalé');
  assert.match(issue.raison, /impossible de trancher/);
});

// --- Idempotence -------------------------------------------------------------

test('un brief déjà publié n est pas réécrit, et ce n est pas un échec', async () => {
  sondeur();
  const client = fauxClient({ publié: true });
  const issue = await lancer({ client });

  assert.equal(issue.statut, 'déjà publié');
  assert.equal(client.écritures.length, 0, 'un rejeu ne doit rien empiler');
});

test('l idempotence est jugée AVANT le moindre appel réseau', async () => {
  // Si les liens étaient sondés d'abord, un rejeu coûterait une minute de
  // requêtes vers des rédactions pour finir par ne rien écrire.
  let sondés = 0;
  globalThis.fetch = async () => {
    sondés++;
    return { ok: true, status: 200 };
  };

  await lancer({ client: fauxClient({ publié: true }) });
  assert.equal(sondés, 0);
});

// --- Garde 2 : les trois verdicts, vus depuis l'orchestration ----------------

test('un lien mort retire son item, et le brief part sans lui', async () => {
  const mort = VALIDE.sections[0].items[0].source_url;
  sondeur({ [mort]: 404 });
  const client = fauxClient();
  const issue = await lancer({ client });

  assert.equal(issue.statut, 'publié');
  const écrits = itemsÉcrits(client).map((i) => i.source_url);
  assert.equal(écrits.length, 5);
  assert.ok(!écrits.includes(mort));
});

test('un accès refusé garde son item, sans date de vérification', async () => {
  const refusé = VALIDE.sections[0].items[0].source_url;
  sondeur({ [refusé]: 403 });
  const client = fauxClient();
  await lancer({ client });

  const item = itemsÉcrits(client).find((i) => i.source_url === refusé);
  assert.ok(item, "un refus d'accès ne doit pas retirer l'item");
  assert.equal(item.link_checked_at, null);
});

test('un item vivant porte, lui, sa date de vérification', async () => {
  sondeur();
  const client = fauxClient();
  await lancer({ client });

  assert.ok(itemsÉcrits(client).every((i) => i.link_checked_at));
});

// --- Garde 3 : l'allowlist ne jette rien, elle retient -----------------------

test('un domaine inconnu retient le brief en brouillon, sans perdre l item', async () => {
  sondeur();
  const client = fauxClient();
  const issue = await lancer({
    client,
    texte: JSON.stringify(
      brief((b) => {
        b.sections[3].items[0].source_url = 'https://exemple-inconnu.test/article';
        return b;
      })
    ),
  });

  assert.equal(issue.statut, 'brouillon');
  const écrit = briefÉcrit(client);
  assert.equal(écrit.status, 'draft');
  assert.match(écrit.failure_reason, /exemple-inconnu\.test/);
  assert.equal(écrit.ingest_status, 'ok', "le brief n'est pas en faute, il attend une relecture");
  assert.equal(itemsÉcrits(client).length, 6, "l'item douteux est conservé, pas jeté");
});

// --- Garde 4 : les doublons --------------------------------------------------

test('un titre déjà couvert les jours précédents fait sauter son item', async () => {
  sondeur();
  const client = fauxClient({ anciens: [VALIDE.sections[0].items[0].headline] });
  await lancer({ client });

  assert.equal(itemsÉcrits(client).length, 5);
});

// --- Garde 5 : elle juge sur CE QUI RESTE ------------------------------------

test('la cohérence se prononce APRÈS les retraits, pas sur le brief proposé', async () => {
  // Le brief propose quatre rubriques pourvues : il serait cohérent tel quel.
  // Les liens morts n'en laissent qu'une, et c'est cela qui doit le recaler.
  const morts = Object.fromEntries(
    [...VALIDE.sections[1].items, ...VALIDE.sections[2].items, ...VALIDE.sections[3].items].map(
      (i) => [i.source_url, 404]
    )
  );
  sondeur(morts);
  const client = fauxClient();
  const issue = await lancer({ client });

  assert.equal(issue.statut, 'recalé');
  assert.match(issue.raison, /cohérence/);
  assert.match(issue.raison, /section/);
  assert.ok(issue.brief, 'le brief recalé reste traçable');
  assert.equal(client.écritures.length, 0, "un brief recalé n'est pas écrit par l'ingestion");
});

test('un brief daté d hier est recalé en bloc', async () => {
  sondeur();
  const issue = await lancer({ aujourdhui: '2026-09-05' });

  assert.equal(issue.statut, 'recalé');
  assert.match(issue.raison, /cohérence/);
});

// --- La météo n'est pas une sixième garde ------------------------------------

test('un service météo muet ne retient jamais un brief', async () => {
  sondeur();
  const client = fauxClient();
  const issue = await lancer({
    client,
    relevé: async () => {
      throw new Error('pas de réponse en 5 s');
    },
  });

  assert.equal(issue.statut, 'publié');
  assert.equal(briefÉcrit(client).weather, undefined, 'la clé reste hors de la charge');
});

test('une météo absente est annoncée au run, sans le faire rougir', async () => {
  sondeur();
  const annonces = [];
  await ingérer({
    nom: NOM,
    texte: JSON.stringify(VALIDE),
    client: fauxClient(),
    aujourdhui: JOUR,
    schéma,
    domaines,
    relevé: async () => {
      throw new Error('HTTP 503');
    },
    annoter: (m) => annonces.push(m),
  });

  assert.equal(annonces.length, 1);
  assert.match(annonces[0], /^::warning::/);
});

test('un brief recalé ne paie pas l appel météo', async () => {
  // La météo vient APRÈS les gardes : un brief qui ne paraîtra pas n'a pas à
  // dépenser une requête pour un encadré qu'on ne verra jamais.
  sondeur();
  let relevés = 0;
  await lancer({
    aujourdhui: '2026-09-05',
    relevé: async () => {
      relevés++;
      return bulletin;
    },
  });

  assert.equal(relevés, 0);
});

// --- Les rubriques vides, de bout en bout ------------------------------------

test('une rubrique vidée par les gardes reçoit sa phrase dans le CMS', async () => {
  const morts = Object.fromEntries(VALIDE.sections[3].items.map((i) => [i.source_url, 404]));
  sondeur(morts);
  const client = fauxClient();
  const issue = await lancer({ client });

  assert.equal(issue.statut, 'publié');
  assert.match(briefÉcrit(client).empty_notes.gaming, /n'a pu être vérifiée/);
});

// --- La trace d'un échec -----------------------------------------------------

test('un brief recalé laisse une trace en brouillon', async () => {
  const client = fauxClient();
  const écrite = await tracerLÉchec({ client, brief: VALIDE, raison: 'cohérence : datée d hier' });

  assert.equal(écrite, true);
  const trace = briefÉcrit(client);
  assert.equal(trace.status, 'draft');
  assert.equal(trace.ingest_status, 'failed');
  assert.match(trace.failure_reason, /datée d hier/);
  assert.equal(itemsÉcrits(client).length, 0, "une trace ne republie pas d'items");
});

test('une trace impossible à écrire ne masque pas la cause première', async () => {
  const client = fauxClient();
  client.post = async () => {
    throw new Error('CMS injoignable');
  };
  const avertissements = [];

  const écrite = await tracerLÉchec({
    client,
    brief: VALIDE,
    raison: 'schéma : champ inventé',
    avertir: (m) => avertissements.push(m),
  });

  assert.equal(écrite, false, 'elle échoue, mais sans lever');
  assert.match(avertissements[0], /trace non écrite/);
});

test('sans brief lisible, il n y a rien à tracer', async () => {
  const client = fauxClient();
  assert.equal(await tracerLÉchec({ client, brief: undefined, raison: 'JSON illisible' }), false);
  assert.equal(client.écritures.length, 0);
});
