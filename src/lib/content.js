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
import { seoulToday } from '../../shared/date.mjs';
import { créerMémo } from './une-fois.js';
import { groupByTag, TAG_WINDOW_DAYS } from './tags.js';

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
 * @property {object|null} fx            cours CHF→KRW (Frankfurter, BCE) figé à
 *   l'ingestion ; absent des briefs parus avant ce champ
 * @property {Record<string,string>|null} empty_notes  pourquoi telle rubrique est
 *   vide ce jour-là, indexé par clé de rubrique ; absent des briefs parus avant
 *   ce champ
 */

/**
 * @typedef {Brief & { sections: { key: string, items: Item[] }[], count: number }} BriefComplet
 * Un brief tel que les pages le consomment : ses items rangés par section.
 */

/**
 * @typedef {object} Evenement
 * @property {number}      id
 * @property {number|null} brief        brief qui l'a repéré ; null s'il a disparu
 * @property {string}      name
 * @property {string}      kind         une clé de shared/evenements.mjs KINDS
 * @property {string}      theme        une clé de THEMES
 * @property {string}      venue
 * @property {string}      area
 * @property {string}      start_date   AAAA-MM-JJ
 * @property {string}      end_date     AAAA-MM-JJ, dernier jour inclus
 * @property {string}      summary
 * @property {string}      source_name
 * @property {string}      source_url
 * @property {string|null} source_lang
 * @property {string|null} booking_url
 * @property {string|null} map_url      fiche Naver Map vue par l'agent ; sinon
 *   le site construit un lien de recherche
 * @property {string}      date_created quand l'ingestion l'a écrit — la date de
 *   publication du flux, stable d'un build à l'autre
 */


const BRIEFS = 'mat_briefs';
const ITEMS = 'mat_news_items';
const EVENTS = 'mat_events';

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

// Combien d'éléments par requête.
//
// « limit=-1 » demandait TOUT en une fois. À quatre briefs c'est indolore ; à
// deux cent cinquante par an, c'est une réponse de plusieurs mégaoctets servie
// par une instance mutualisée de 384 Mo dont le pool ne tient que trois
// connexions. La panne serait arrivée un matin, sur le build, sans rapport
// apparent avec sa cause — et un an après le commit qui l'aura causée.
//
// Mille : assez large pour que l'archive tienne en une requête pendant des
// années, assez borné pour que la réponse reste d'une taille connue.
const PAR_PAGE = 1000;

/**
 * Lit une collection entière, page par page.
 *
 * La boucle s'arrête sur une page incomplète — c'est la seule condition qui ne
 * suppose rien du total, que Directus ne donne pas sans qu'on le lui demande.
 *
 * @param {string} chemin  l'adresse SANS « limit » ni « page »
 * @returns {Promise<any[]>}
 */
async function requestAll(chemin) {
  const tout = [];

  for (let page = 1; ; page++) {
    const lot = await request(`${chemin}&limit=${PAR_PAGE}&page=${page}`);
    if (!lot?.length) break;

    tout.push(...lot);
    if (lot.length < PAR_PAGE) break;

    // Un garde-fou, pas une limite de conception : si Directus rendait des
    // pages pleines indéfiniment, mieux vaut échouer bruyamment que boucler
    // jusqu'à épuiser la mémoire du runner.
    if (page > 100) {
      throw new Error(`CMS ${chemin} : plus de cent pages, la pagination ne termine pas.`);
    }
  }

  return tout;
}

// Une fois, et une seule, par build. Les raisons — et le piège du rejet gardé —
// sont dans le module, avec ses tests.
const uneFois = créerMémo();

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
    const briefs = await requestAll(
      `/items/${BRIEFS}?sort=-date&fields=id,date,slug,title,standfirst,ingested_at,weather,fx,empty_notes`
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
    const items = await requestAll(
      `/items/${ITEMS}?sort=importance` +
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
 * Les étiquettes qui portent une page, chacune avec ses jours.
 *
 * Mémoïsé comme le reste : NewsItem le demande pour chaque item rendu, afin de
 * savoir s'il pose un lien, et les pages d'étiquette s'en servent pour savoir
 * lesquelles construire. Une seule règle pour les deux — deux règles qui
 * divergeraient sèmeraient des liens vers des pages inexistantes.
 *
 * @returns {Promise<Map<string, {brief: any, items: any[]}[]>>}
 */
export function tagPages() {
  return uneFois('tags', async () => groupByTag(await recentBriefs(TAG_WINDOW_DAYS)));
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

/**
 * Les événements publiés encore en cours ou à venir, du plus proche au plus
 * lointain.
 *
 * ZÉRO N'EST PAS UNE PANNE, à la différence des briefs : une semaine sans
 * pop-up existe, et la page le dit. Une collection absente, elle, reste une
 * panne — la requête échoue, et le build avec, comme pour toute source qui
 * manque.
 *
 * Filtré sur la date de fin au build, ce qui suffit presque : le site se
 * reconstruit chaque matin. Le « presque » est un build qui échoue — et la page
 * le rattrape chez le lecteur, en quelques lignes, comme l'avis de parution.
 *
 * @returns {Promise<Evenement[]>}
 */
export function listEvents() {
  return uneFois('events', () =>
    requestAll(
      `/items/${EVENTS}?sort=start_date,end_date,name` +
        `&filter[end_date][_gte]=${seoulToday()}` +
        `&fields=id,brief,name,kind,theme,venue,area,start_date,end_date,summary,` +
        `source_name,source_url,source_lang,booking_url,map_url,date_created`
    )
  );
}
