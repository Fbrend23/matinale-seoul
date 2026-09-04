// Accès Directus de la chaîne d'ingestion.
//
// Le jeton porté ici est celui de la policy « mat — écriture » : il crée et met
// à jour le contenu de la Matinale, rien d'autre. Ni l'admin (réservé au
// provisionnement, dans platform-cms), ni celui du build (lecture seule du
// publié). Les confondre ferait réussir en local ce qui échouerait en CI.

const BRIEFS = 'mat_briefs';
const ITEMS = 'mat_news_items';

export function createClient({ url, token }) {
  if (!url || !token) {
    throw new Error('DIRECTUS_URL et DIRECTUS_TOKEN sont requis pour écrire dans le CMS.');
  }

  const base = url.replace(/\/$/, '');

  async function api(method, path, body, attempt = 0) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);

    // Le limiteur de débit de l'instance est serré : elle est mutualisée et
    // hébergée sur du mutualisé. On respecte l'attente qu'elle annonce plutôt
    // que de la desserrer sur le serveur, où elle le resterait.
    if (res.status === 429 && attempt < 6) {
      const entête = Number(res.headers.get('retry-after'));
      const délai = Number.isFinite(entête) && entête ? entête * 1000 + 50 : 500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, délai));
      return api(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      const détail = json?.errors?.[0]?.message ?? res.statusText;
      throw new Error(`${method} ${path} → ${res.status} ${détail}`);
    }

    return json?.data ?? null;
  }

  return {
    get: (p) => api('GET', p),
    post: (p, b) => api('POST', p, b),
    patch: (p, b) => api('PATCH', p, b),
  };
}

/** Le brief de ce jour, s'il existe déjà, quel que soit son statut. */
export async function briefForDate(client, date) {
  const trouvés = await client.get(
    `/items/${BRIEFS}?filter[date][_eq]=${date}&fields=id,status,ingest_status&limit=1`
  );
  return trouvés?.[0] ?? null;
}

/**
 * Les titres des jours PRÉCÉDENTS, contre lesquels se mesurent les doublons.
 *
 * Strictement avant aujourd'hui : sans cela, rejouer l'ingestion du jour
 * comparerait le brief à lui-même et retirerait tous ses items.
 */
export async function recentHeadlines(client, { today, days = 14 }) {
  const depuis = new Date(`${today}T00:00:00Z`);
  depuis.setUTCDate(depuis.getUTCDate() - days);
  const début = depuis.toISOString().slice(0, 10);

  const items = await client.get(
    `/items/${ITEMS}?fields=headline` +
      `&filter[brief][date][_gte]=${début}` +
      `&filter[brief][date][_lt]=${today}` +
      `&limit=-1`
  );

  return (items ?? []).map((i) => i.headline);
}

/**
 * Écrit le brief et ses items.
 *
 * Un rejeu ARCHIVE les items du passage précédent au lieu de les supprimer :
 * la chaîne n'a pas le droit d'effacer, et n'en a pas besoin. Le site ne lit
 * que « published », les archivés en sortent donc d'eux-mêmes, et ce qui a été
 * ingéré une première fois reste consultable dans le CMS.
 */
export async function saveBrief(client, { brief, items, status, ingestStatus, failureReason }) {
  const charge = {
    status,
    date: brief.date,
    slug: `brief-${brief.date}`,
    title: brief.title,
    standfirst: brief.standfirst,
    ingest_status: ingestStatus,
    failure_reason: failureReason ?? null,
    ingested_at: new Date().toISOString(),
  };

  const existant = await briefForDate(client, brief.date);
  let id;

  if (existant) {
    await client.patch(`/items/${BRIEFS}/${existant.id}`, charge);
    id = existant.id;

    const anciens = await client.get(
      `/items/${ITEMS}?filter[brief][_eq]=${id}&filter[status][_neq]=archived&fields=id&limit=-1`
    );
    for (const ancien of anciens ?? []) {
      await client.patch(`/items/${ITEMS}/${ancien.id}`, { status: 'archived' });
    }
  } else {
    const créé = await client.post(`/items/${BRIEFS}`, charge);
    id = créé.id;
  }

  for (const [rang, item] of items.entries()) {
    await client.post(`/items/${ITEMS}`, {
      status,
      sort: rang + 1,
      brief: id,
      section: item.section,
      headline: item.headline,
      summary: item.summary,
      analysis: item.analysis ?? null,
      importance: item.importance,
      tags: item.tags ?? [],
      source_name: item.source_name,
      source_url: item.source_url,
      source_lang: item.source_lang ?? null,
      published_at: item.published_at ?? null,
      link_checked_at: item.link_checked_at ?? null,
    });
  }

  return id;
}
