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
import { briefForDate, recentHeadlines, saveBrief } from './directus.mjs';
import { relevéMétéo } from './meteo.mjs';

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
    emptyNotes: notes,
    ingestStatus: 'ok',
    failureReason: inconnus.length
      ? `Domaines absents de config/sources.json : ${[...new Set(inconnus.map((i) => i.host))].join(', ')}. ` +
        `Le brief attend une relecture : ajouter les domaines s'ils sont légitimes, puis republier.`
      : null,
  });

  dire(`   écrit : brief ${id}, ${retenus.length} items, statut « ${statut} »`);
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
