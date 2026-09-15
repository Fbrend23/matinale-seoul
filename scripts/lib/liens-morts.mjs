// Les liens qui meurent après la publication.
//
// La garde 2 vérifie chaque source le matin de sa parution, puis plus jamais.
// Or une page de presse disparaît, un billet de blog est retiré, un
// hébergeur ferme, et l'archive continue d'y lier pendant des années. Ce
// module revisite les sources publiées, et marque celles qui ont disparu :
// le site cesse alors d'y lier, l'item reste, avec le nom de sa source. On
// ne retire pas un item pour un lien mort : ce qu'il disait était vrai le
// jour où il l'a dit.
//
// MORT, ICI, VEUT DIRE 404 OU 410, DEUX FOIS. La garde 2 compte aussi les
// 5xx et les silences parmi les morts, parce qu'elle cherche des adresses
// INVENTÉES et qu'un item retiré du brief du jour n'est qu'un item de moins.
// Ici, la sanction est durable : un site en panne le dimanche n'a pas perdu
// son article, et un robot qu'on refuse (403) n'a rien vu. Seule la réponse
// « cette page n'existe pas », rendue deux fois à une minute d'écart, vaut
// disparition. Et si la page revient, la marque s'efface.
//
// Tout est injectable, le client CMS, le fetch, l'attente : c'est ce qui rend
// le contrôle testable sans réseau, comme les gardes.

import { checkLinks } from './guards.mjs';
import { jourPlus } from '../../shared/date.mjs';

const ITEMS = 'mat_news_items';
const EVENTS = 'mat_events';

/**
 * Combien de jours en arrière on revisite.
 *
 * Au-delà, les liens ont déjà été vus douze fois : ceux qui devaient mourir
 * sont marqués, et sonder toute l'archive chaque semaine ferait grossir le
 * job avec elle, sans rien apprendre de plus. Un item marqué reste marqué
 * une fois sorti de la fenêtre, et un lien qui meurt plus tard reste lié :
 * c'est le prix, et il est connu.
 */
export const FENÊTRE_JOURS = 90;

/** Entre les deux sondes d'un candidat : assez pour qu'un hoquet passe. */
export const ATTENTE_CONFIRMATION_MS = 60_000;

/** Les seules réponses qui disent « cette page n'existe pas ». */
const DISPARU = /^HTTP (404|410)$/;

/**
 * Ce qu'il y a à sonder : les items publiés des briefs de la fenêtre, et les
 * événements non archivés dont la fin est dans la fenêtre. Ceux déjà marqués
 * y sont aussi : c'est ainsi qu'une page revenue perd sa marque.
 *
 * @param {{get: (chemin: string) => Promise<any>}} client
 * @param {{today: string, jours?: number}} p
 * @returns {Promise<{collection: string, id: number, source_url: string, link_dead_at: string|null}[]>}
 */
export async function àSonder(client, { today, jours = FENÊTRE_JOURS }) {
  const depuis = jourPlus(today, -jours);

  const items = await client.get(
    `/items/${ITEMS}?fields=id,source_url,link_dead_at` +
      `&filter[status][_eq]=published` +
      `&filter[brief][date][_gte]=${depuis}` +
      `&limit=-1`
  );
  const events = await client.get(
    `/items/${EVENTS}?fields=id,source_url,link_dead_at` +
      `&filter[status][_neq]=archived` +
      `&filter[end_date][_gte]=${depuis}` +
      `&limit=-1`
  );

  const étiqueter = (collection) => (x) => ({
    collection,
    id: x.id,
    source_url: x.source_url,
    link_dead_at: x.link_dead_at ?? null,
  });

  return [...(items ?? []).map(étiqueter(ITEMS)), ...(events ?? []).map(étiqueter(EVENTS))];
}

/**
 * Sonde tout, puis resonde les seuls candidats, et rend ce qui change.
 *
 *   morts        répondaient, et ne répondent plus, deux fois « n'existe pas »
 *   ressuscités  étaient marqués, et répondent à nouveau
 *
 * Tout le reste, refus, panne, silence, un seul 404 sur deux, ne change rien.
 *
 * @param {ReturnType<typeof àSonder> extends Promise<infer T> ? T : never} cibles
 * @param {{fetcher?: typeof fetch, dormir?: (ms: number) => Promise<void>, attenteMs?: number, timeoutMs?: number}} [options]
 */
export async function vérifierLiens(
  cibles,
  { fetcher = fetch, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), attenteMs = ATTENTE_CONFIRMATION_MS, timeoutMs = 10_000 } = {}
) {
  const première = await checkLinks(cibles, { fetcher, timeoutMs });

  const ressuscités = [];
  const candidats = [];
  for (const sonde of première) {
    const cible = sonde.item;
    if (sonde.verdict === 'vivant' && cible.link_dead_at) ressuscités.push(cible);
    if (sonde.verdict === 'mort' && DISPARU.test(sonde.reason ?? '') && !cible.link_dead_at) candidats.push(cible);
  }

  const morts = [];
  if (candidats.length) {
    await dormir(attenteMs);
    const seconde = await checkLinks(candidats, { fetcher, timeoutMs });
    for (const sonde of seconde) {
      if (sonde.verdict === 'mort' && DISPARU.test(sonde.reason ?? '')) morts.push(sonde.item);
    }
  }

  return { morts, ressuscités, sondés: cibles.length };
}

/**
 * Pose ou efface la marque, collection par collection, en un PATCH groupé
 * chacune : Directus accepte une liste de clés et une seule charge.
 *
 * @param {{patch: (chemin: string, corps: any) => Promise<any>}} client
 * @param {{morts: {collection: string, id: number}[], ressuscités: {collection: string, id: number}[], maintenant: string}} p
 */
export async function marquer(client, { morts, ressuscités, maintenant }) {
  const parCollection = (liste) => {
    const m = new Map();
    for (const { collection, id } of liste) {
      if (!m.has(collection)) m.set(collection, []);
      m.get(collection).push(id);
    }
    return m;
  };

  for (const [collection, keys] of parCollection(morts)) {
    await client.patch(`/items/${collection}`, { keys, data: { link_dead_at: maintenant } });
  }
  for (const [collection, keys] of parCollection(ressuscités)) {
    await client.patch(`/items/${collection}`, { keys, data: { link_dead_at: null } });
  }
}
