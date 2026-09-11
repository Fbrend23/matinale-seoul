// Lecture du CMS au build. Le site n'a pas d'autre source.
//
// Le jeton est celui de la policy « mat — lecture build » : lecture seule, et
// filtrée sur `status = published` par Directus lui-même. Un brief en brouillon
// — recalé par les gardes, ou retenu parce qu'un domaine est inconnu — reste
// donc invisible ici, même si une requête l'oubliait.
//
// AUCUN REPLI LOCAL, volontairement. Un site qui se construit sans ses sources
// publierait un contenu figé sans rien dire, et c'est précisément le silence que
// toute la chaîne cherche à fermer. Quand le build échoue, le déploiement
// précédent reste en ligne : le lecteur voit le brief d'hier, ce qui est vrai,
// plutôt qu'une page vide ou éternellement fraîche.

import { DIRECTUS_URL, DIRECTUS_TOKEN } from 'astro:env/server';
import { SECTIONS } from '../../shared/sections.mjs';

// Les formes que le CMS rend. Écrites en JSDoc plutôt qu'en TypeScript : le
// dépôt est en JavaScript, et une annotation qui demanderait une compilation
// coûterait plus qu'elle ne rapporte. `astro check` les lit, et les pages
// cessent de deviner ce qu'elles reçoivent.
//
// Elles décrivent ce que le BUILD voit, c'est-à-dire le contenu publié — pas le
// contrat de sortie de l'agent, qui est dans schemas/brief.schema.json et porte
// d'autres champs.

/**
 * @typedef {object} Item
 * @property {number}        id
 * @property {number}        brief        identifiant du brief porteur
 * @property {string}        section      une clé de shared/sections.mjs
 * @property {string}        headline
 * @property {string}        summary
 * @property {string|null}   analysis     une au plus par section
 * @property {number}        importance   1 = le plus important de sa section
 * @property {string[]}      tags
 * @property {string}        source_name
 * @property {string}        source_url
 * @property {string|null}   source_lang
 * @property {string|null}   published_at
 */

/**
 * @typedef {object} Brief
 * @property {number}      id
 * @property {string}      date          AAAA-MM-JJ, heure de Séoul
 * @property {string}      slug
 * @property {string}      title
 * @property {string}      standfirst
 * @property {string}      ingested_at
 * @property {object|null} weather       bulletin Open-Meteo figé à l'ingestion
 * @property {Record<string,string>|null} empty_notes  pourquoi telle rubrique est
 *   vide ce jour-là, indexé par clé de rubrique ; absent des briefs parus avant
 *   ce champ
 */

/**
 * @typedef {Brief & { sections: { key: string, items: Item[] }[], count: number }} BriefComplet
 * Un brief tel que les pages le consomment : ses items rangés par section.
 */


const BRIEFS = 'mat_briefs';
const ITEMS = 'mat_news_items';

async function request(path) {
  let res;
  try {
    res = await fetch(`${DIRECTUS_URL}${path}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
    });
  } catch (e) {
    throw new Error(`CMS injoignable (${path}) : ${e.message}`);
  }

  if (!res.ok) {
    const détail = await res.text().catch(() => '');
    throw new Error(`CMS ${path} : HTTP ${res.status} ${détail}`.trim());
  }

  const json = await res.json();
  return json?.data ?? null;
}

// --- Une fois, et une seule, par build ---------------------------------------
//
// Six pages demandaient la même liste de briefs, cinq d'entre elles la même
// liste d'items : onze requêtes pour deux réponses, vers une instance mutualisée
// de 384 Mo dont le pool ne tient que trois connexions.
//
// Le build est un processus unique et le contenu est figé pour sa durée : la
// mémoïsation est sûre ici, et nulle part ailleurs.
//
// ON MÉMOÏSE LA PROMESSE, PAS LE RÉSULTAT. Deux pages rendues en parallèle
// doivent partager la requête EN VOL ; mémoïser la valeur les ferait partir
// toutes les deux avant que la première ne revienne.
//
// CE N'EST PAS UN REPLI. Un rejet est gardé tel quel et relancé à l'identique :
// quand le CMS ne répond pas, le build doit échouer, pas servir du figé. C'est
// toute la doctrine du fichier, et un cache est précisément ce qui pourrait la
// trahir sans bruit.
const enCache = new Map();

function uneFois(clé, produire) {
  if (!enCache.has(clé)) enCache.set(clé, produire());
  return enCache.get(clé);
}

/**
 * Tous les briefs publiés, du plus récent au plus ancien.
 *
 * Zéro brief n'est pas un site vide, c'est une chaîne cassée : la publication
 * est quotidienne. On refuse de construire plutôt que de mettre en ligne un
 * site sans contenu, qui écraserait celui d'hier.
 *
 * @returns {Promise<Brief[]>}
 */
export function listBriefs() {
  return uneFois('briefs', async () => {
    const briefs = await request(
      `/items/${BRIEFS}?limit=-1&sort=-date&fields=id,date,slug,title,standfirst,ingested_at,weather,empty_notes`
    );

    if (!briefs?.length) {
      throw new Error(
        'Aucun brief publié dans le CMS. Le site ne sera pas reconstruit : ' +
          "le déploiement précédent reste en ligne, ce qui vaut mieux qu'un site vide."
      );
    }

    return briefs;
  });
}

/**
 * Les items publiés des briefs demandés, rangés par section puis par rang.
 *
 * @param {number[]} briefIds
 * @returns {Promise<Map<number, Item[]>>}
 */
export async function itemsFor(briefIds) {
  if (!briefIds.length) return new Map();

  const tous = await tousLesItems();
  return new Map(briefIds.map((id) => [id, tous.get(id) ?? []]));
}

/**
 * Tous les items publiés, rangés par brief. Une requête pour tout le build.
 *
 * SANS « filter[brief][_in] », et c'est le point. L'ancienne version listait
 * les identifiants dans l'adresse : à deux cent cinquante briefs par an, cette
 * URL finissait par dépasser les limites usuelles, et la panne serait arrivée
 * un matin, sur le build, sans rapport apparent avec sa cause.
 *
 * Ne rien filtrer ne coûte rien de plus : la page d'un brief se construit pour
 * CHAQUE brief publié, donc le build lit de toute façon l'archive entière. On
 * la lit une fois plutôt que cinq.
 *
 * Le jour où l'archive deviendrait trop lourde pour une seule réponse, c'est la
 * pagination par curseur qu'il faudra, pas le retour du filtre.
 *
 * @returns {Promise<Map<number, Item[]>>}
 */
function tousLesItems() {
  return uneFois('items', async () => {
    const items = await request(
      `/items/${ITEMS}?limit=-1&sort=importance` +
        `&fields=id,brief,section,headline,summary,analysis,importance,tags,` +
        `source_name,source_url,source_lang,published_at`
    );

    const parBrief = new Map();
    for (const item of items ?? []) {
      if (!parBrief.has(item.brief)) parBrief.set(item.brief, []);
      parBrief.get(item.brief).push(item);
    }
    return parBrief;
  });
}

/**
 * Un brief complet : ses métadonnées et ses items rangés par section.
 *
 * @param {Brief} brief
 * @param {Item[]} items
 * @returns {BriefComplet}
 */
export function assemble(brief, items) {
  return {
    ...brief,
    sections: SECTIONS.map((key) => ({
      key,
      // La phrase que l'agent — ou l'ingestion — a écrite sous une rubrique
      // restée vide. Nulle pour les briefs parus avant ce champ : le composant
      // retombe alors sur sa formule générale.
      empty_note: brief.empty_notes?.[key] ?? null,
      items: items
        .filter((i) => i.section === key)
        .sort((a, b) => (a.importance ?? 99) - (b.importance ?? 99)),
    })),
    count: items.length,
  };
}

/**
 * Les `n` briefs les plus récents, items compris.
 *
 * @returns {Promise<BriefComplet[]>}
 */
export async function recentBriefs(n = 14) {
  const briefs = (await listBriefs()).slice(0, n);
  const items = await itemsFor(briefs.map((b) => b.id));
  return briefs.map((b) => assemble(b, items.get(b.id) ?? []));
}

/**
 * Tous les briefs, items compris. Utilisé par les pages d'archive.
 *
 * @returns {Promise<BriefComplet[]>}
 */
export async function allBriefs() {
  const briefs = await listBriefs();
  const items = await itemsFor(briefs.map((b) => b.id));
  return briefs.map((b) => assemble(b, items.get(b.id) ?? []));
}
