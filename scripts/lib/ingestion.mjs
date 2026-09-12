// L'ingestion d'un brief : l'ordre des gardes, et ce qu'on décide de leur verdict.
//
// Séparé de scripts/ingest.mjs, qui garde l'entrée-sortie — lire l'inbox,
// construire le client, poser le code de sortie. Ici, rien ne touche au disque
// ni au réseau de sa propre initiative : tout arrive en paramètre.
//
// POURQUOI CETTE SÉPARATION. C'est le cœur de la chaîne : l'ORDRE des cinq
// gardes, le choix entre « publié » et « brouillon », l'idempotence qui empêche
// un rejeu d'écrire deux fois. Chaque brique était testée, leur enchaînement ne
// l'était pas — et c'est l'enchaînement qui porte les décisions. Un script qui
// s'exécute au chargement ne se teste pas ; une fonction qui reçoit ses
// dépendances, si.

import {
  validateSchema,
  checkLinks,
  checkAllowlist,
  findDuplicates,
  checkCoherence,
  emptyNotes,
  sourceSpread,
  flatten,
  unflatten,
} from './guards.mjs';
import {
  briefForDate,
  recentHeadlines,
  saveBrief,
  activeEvents,
  saveEvents,
  archiveExpiredEvents,
} from './directus.mjs';
import { relevéMétéo } from './meteo.mjs';
import { relevéChange } from './change.mjs';
import { contrôlerÉvénements } from './evenements.mjs';

export const NOM_ATTENDU = /^brief-(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Ingère un brief déjà lu.
 *
 * L'ORDRE compte, et c'est tout l'objet de cette fonction : la cohérence se
 * juge sur ce qui RESTE une fois les liens morts et les doublons retirés, pas
 * sur ce que l'agent a proposé. Intervertir deux gardes changerait le verdict
 * sans qu'aucun test unitaire ne s'en aperçoive.
 *
 * @param {object} p
 * @param {string} p.nom          nom du fichier, qui dit de quel jour on parle
 * @param {string} p.texte        son contenu brut, pas encore analysé
 * @param {object} p.client       client Directus
 * @param {string} p.aujourdhui   le jour à Séoul, décidé par l'appelant
 * @param {object} p.schéma       brief.schema.json, déjà lu
 * @param {string[]} p.domaines   l'allowlist, déjà lue
 * @param {Function} [p.relevé]   le bulletin météo ; injectable pour les tests
 * @param {Function} [p.cours]    le cours du change ; injectable de même
 * @param {Function} [p.dire]     le journal du run
 * @param {Function} [p.annoter]  les annotations GitHub Actions (::warning::)
 * @returns {Promise<{statut: string, raison?: string, brief?: object, id?: any}>}
 */
export async function ingérer({
  nom,
  texte,
  client,
  aujourdhui,
  schéma,
  domaines,
  relevé = relevéMétéo,
  cours = relevéChange,
  dire = () => {},
  annoter = () => {},
}) {
  dire(`\n── ${nom}`);

  // Le nom du fichier est la première chose vérifiée : il est écrit par un
  // agent, et c'est lui qui dit de quel jour on parle.
  const nommage = NOM_ATTENDU.exec(nom);
  if (!nommage) {
    return { statut: 'recalé', raison: `nom de fichier hors format brief-YYYY-MM-DD.json : ${nom}` };
  }

  let brief;
  try {
    brief = JSON.parse(texte);
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
  // Trois verdicts. Un refus d'accès (403, mur anti-robot, mur payant) ne prouve
  // pas que l'URL est inventée : l'item reste, et le journal dit pourquoi sa
  // date de vérification manque.
  const sondes = await checkLinks(items);

  const morts = sondes.filter((s) => s.verdict === 'mort');
  for (const mort of morts) {
    dire(`   garde 2 · lien mort, item retiré : ${mort.item.source_url} (${mort.reason})`);
  }

  const refusés = sondes.filter((s) => s.verdict === 'refusé');
  for (const refus of refusés) {
    dire(`   garde 2 · accès refusé, item CONSERVÉ : ${refus.item.source_url} (${refus.reason})`);
  }

  const vivants = sondes
    .filter((s) => s.ok)
    .map((s) => ({ ...s.item, link_checked_at: s.checkedAt }));
  const joignables = sondes.length - morts.length - refusés.length;
  dire(
    `   garde 2 · liens : ${joignables} vivants, ${refusés.length} refusés (conservés), ` +
      `${morts.length} morts`
  );

  // --- Garde 3 : allowlist ---
  const inconnus = checkAllowlist(vivants, domaines);
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

  // --- D'où vient ce brief ---
  // Ni garde ni veto : une trace. L'allowlist compte une cinquantaine de
  // domaines et les premiers briefs n'en ont utilisé que trois ou quatre. Une
  // journée peut légitimement appartenir à une seule rédaction ; c'est la
  // répétition qui se lit, et elle ne se lit que si chaque run la note.
  const sources = sourceSpread(retenus);
  dire(
    `   sources · ${sources.length} domaine(s) : ` +
      sources.map((s) => `${s.host} ×${s.n}`).join(', ')
  );

  // Un brief étoffé dont plus de la moitié vient d'une seule rédaction mérite
  // d'être vu passer. Le plancher évite de crier sur un brief court, où deux
  // items sur trois ne veulent rien dire.
  const dominante = sources[0];
  if (dominante && retenus.length >= 6 && dominante.n * 2 > retenus.length) {
    annoter(
      `::notice::${dominante.host} porte ${dominante.n} des ${retenus.length} items ` +
        `du brief ${brief.date}.`
    );
  }

  // --- Garde 5 : cohérence, sur ce qui reste ---
  const restant = unflatten(brief, retenus);
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
    météo = await relevé({ date: brief.date });
    dire(`   météo · ${météo.tmin} à ${météo.tmax} °C, code WMO ${météo.code}`);
  } catch (e) {
    dire(`   météo · indisponible, le brief part sans son bloc : ${e.message}`);
    // Annotation dans le résumé du run : l'absence se voit sans que le job
    // passe au rouge. Un encadré manquant n'est pas une panne de publication.
    annoter(`::warning::Météo absente du brief ${brief.date} : ${e.message}`);
  }

  // --- Cours du change ---
  // Même statut que la météo, mêmes raisons : un accessoire, qui n'a rien à
  // recaler et dont l'absence se lit au journal du run.
  let change = null;
  try {
    change = await cours({ date: brief.date });
    dire(`   change · 1 ${change.base} = ${change.rate} ${change.quote} (cours BCE du ${change.rate_date})`);
  } catch (e) {
    dire(`   change · indisponible, le brief part sans son bloc : ${e.message}`);
    annoter(`::warning::Cours du change absent du brief ${brief.date} : ${e.message}`);
  }

  // --- Écriture ---
  // Les notes se calculent sur « restant », donc APRÈS les gardes : une rubrique
  // que les liens morts ont vidée reçoit la sienne, là où le fichier de l'agent
  // ne portait rien.
  const notes = emptyNotes(restant);
  if (notes) {
    dire(`   rubriques vides : ${Object.keys(notes).join(', ')}`);
  }

  const statut = inconnus.length ? 'draft' : 'published';
  const id = await saveBrief(client, {
    brief,
    items: retenus,
    status: statut,
    weather: météo,
    fx: change,
    emptyNotes: notes,
    ingestStatus: 'ok',
    failureReason: inconnus.length
      ? `Domaines absents de config/sources.json : ${[...new Set(inconnus.map((i) => i.host))].join(', ')}. ` +
        `Le brief attend une relecture : ajouter les domaines s'ils sont légitimes, puis republier.`
      : null,
  });

  dire(`   écrit : brief ${id}, ${retenus.length} items, statut « ${statut} »`);

  // --- Pop-ups et événements ---
  // Ni sixième garde ni cinquième rubrique : un accessoire, comme la météo.
  // Tout ce qui cloche ici ÉCARTE un événement ou saute l'étape, et rien ne
  // touche au verdict rendu plus haut. Après l'écriture du brief, donc : un
  // événement porte l'identifiant du brief qui l'a repéré, et le brief n'a pas
  // à attendre qu'on ait fini de sonder une boutique éphémère.
  //
  // Les événements partent « published » même quand le brief est retenu en
  // brouillon : ce qui retient le brief est le domaine d'un ITEM, et chaque
  // événement a passé sa propre allowlist. Les écrire en brouillon les ferait
  // de surcroît compter comme connus au rejeu, qui écarterait alors la version
  // corrigée pour garder l'invisible.
  const proposés = brief.events ?? [];
  try {
    // « Sauf ce brief » : ses événements d'un passage précédent vont être
    // archivés par saveEvents ; les compter comme connus écarterait le rejeu.
    const connus = await activeEvents(client, { today: aujourdhui, saufBrief: id });
    const { retenus: événements, écartés, liensRetirés } = await contrôlerÉvénements(proposés, {
      domaines,
      connus,
      today: aujourdhui,
    });

    for (const { event, raison } of écartés) {
      dire(`   événements · écarté « ${event.name.slice(0, 60)} » : ${raison}`);
    }
    for (const { event, champ, raison } of liensRetirés) {
      dire(`   événements · ${champ} retiré de « ${event.name.slice(0, 60)} » : ${raison}`);
    }

    const écrits = await saveEvents(client, { events: événements, briefId: id });
    if (proposés.length) {
      dire(`   événements · ${écrits} écrit(s) sur ${proposés.length} proposé(s)`);
    }

    // Une seule annotation pour tous les écartés : le résumé du run doit se
    // lire d'un coup d'œil, pas se dérouler.
    if (écartés.length) {
      annoter(
        `::warning::${écartés.length} événement(s) écarté(s) du brief ${brief.date} : ` +
          écartés.map((e) => `« ${e.event.name.slice(0, 40)} » (${e.raison})`).join(' ; ')
      );
    }
  } catch (e) {
    dire(`   événements · non écrits, le brief est déjà en ligne : ${e.message}`);
    annoter(
      `::warning::Événements du brief ${brief.date} non écrits : ${e.message}` +
        (proposés.length ? ` — ${proposés.length} proposé(s) perdu(s) pour ce run.` : '')
    );
  }

  // Ce qui est fini sort de la page, et il en sort par l'archive : la chaîne
  // n'efface jamais. Une étape à part, jouée à chaque run — un brief sans
  // événement doit quand même ranger ceux d'hier.
  try {
    const finis = await archiveExpiredEvents(client, { today: aujourdhui });
    if (finis.length) {
      dire(`   événements · ${finis.length} terminé(s) archivé(s) : ${finis.map((f) => f.name).join(', ')}`);
    }
  } catch (e) {
    dire(`   événements · archivage impossible : ${e.message}`);
    annoter(`::warning::Événements terminés non archivés (${brief.date}) : ${e.message}`);
  }

  return { statut: statut === 'published' ? 'publié' : 'brouillon', id };
}

/**
 * Écrit dans le CMS la trace d'un brief recalé.
 *
 * Un brief recalé est tout de même écrit, en brouillon : c'est la seule trace
 * durable de son passage. Sans elle, un échec ne laisserait que des journaux de
 * CI, qui expirent.
 *
 * Cette écriture ne doit JAMAIS masquer la cause première — si elle échoue à son
 * tour, on le dit et on s'arrête là. Le brief est déjà recalé ; une seconde
 * panne par-dessus ne changerait ni le verdict ni le code de sortie.
 */
export async function tracerLÉchec({ client, brief, raison, dire = () => {}, avertir = () => {} }) {
  if (!brief) return false;

  try {
    await saveBrief(client, {
      brief,
      items: [],
      status: 'draft',
      ingestStatus: 'failed',
      failureReason: raison,
    });
    dire('   trace écrite dans le CMS (brouillon, ingest_status = failed)');
    return true;
  } catch (e) {
    avertir(`   (trace non écrite : ${e.message})`);
    return false;
  }
}
