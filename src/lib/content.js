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

/**
 * Tous les briefs publiés, du plus récent au plus ancien.
 *
 * Zéro brief n'est pas un site vide, c'est une chaîne cassée : la publication
 * est quotidienne. On refuse de construire plutôt que de mettre en ligne un
 * site sans contenu, qui écraserait celui d'hier.
 */
export async function listBriefs() {
  const briefs = await request(
    `/items/${BRIEFS}?limit=-1&sort=-date&fields=id,date,slug,title,standfirst,ingested_at,weather`
  );

  if (!briefs?.length) {
    throw new Error(
      'Aucun brief publié dans le CMS. Le site ne sera pas reconstruit : ' +
        "le déploiement précédent reste en ligne, ce qui vaut mieux qu'un site vide."
    );
  }

  return briefs;
}

/** Les items publiés des briefs demandés, rangés par section puis par rang. */
export async function itemsFor(briefIds) {
  if (!briefIds.length) return new Map();

  const items = await request(
    `/items/${ITEMS}?limit=-1&sort=importance` +
      `&filter[brief][_in]=${briefIds.join(',')}` +
      `&fields=id,brief,section,headline,summary,analysis,importance,tags,` +
      `source_name,source_url,source_lang,published_at`
  );

  const parBrief = new Map(briefIds.map((id) => [id, []]));
  for (const item of items ?? []) {
    parBrief.get(item.brief)?.push(item);
  }
  return parBrief;
}

/** Un brief complet : ses métadonnées et ses items rangés par section. */
export function assemble(brief, items) {
  return {
    ...brief,
    sections: SECTIONS.map((key) => ({
      key,
      items: items
        .filter((i) => i.section === key)
        .sort((a, b) => (a.importance ?? 99) - (b.importance ?? 99)),
    })),
    count: items.length,
  };
}

/** Les `n` briefs les plus récents, items compris. */
export async function recentBriefs(n = 14) {
  const briefs = (await listBriefs()).slice(0, n);
  const items = await itemsFor(briefs.map((b) => b.id));
  return briefs.map((b) => assemble(b, items.get(b.id) ?? []));
}

/** Tous les briefs, items compris. Utilisé par les pages d'archive. */
export async function allBriefs() {
  const briefs = await listBriefs();
  const items = await itemsFor(briefs.map((b) => b.id));
  return briefs.map((b) => assemble(b, items.get(b.id) ?? []));
}
