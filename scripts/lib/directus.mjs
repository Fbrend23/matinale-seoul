// Accès Directus de la chaîne d'ingestion.
//
// Le jeton porté ici est celui de la policy « mat — écriture » : il crée et met
// à jour le contenu de la Matinale, rien d'autre. Ni l'admin (réservé au
// provisionnement, dans platform-cms), ni celui du build (lecture seule du
// publié). Les confondre ferait réussir en local ce qui échouerait en CI.

const BRIEFS = 'mat_briefs';
const ITEMS = 'mat_news_items';

// Attentes entre deux tentatives quand la connexion n'aboutit pas du tout.
// Douze secondes en tout : de quoi passer un redémarrage de l'instance ou un
// hoquet de son proxy, sans entamer la marge avant 8 h, heure de Séoul.
const ATTENTES_RÉSEAU = [1000, 3000, 8000];

/**
 * « fetch failed » ne nomme pas la panne — tout est dans la cause.
 *
 * Vu le 10 septembre 2026 : la publication du brief du 11 est morte sur un
 * « erreur pendant l'ingestion : fetch failed », et il a fallu prouver par le
 * journal du job — une connexion FTP réussie neuf secondes plus tôt — que le
 * runner allait bien et que c'était le CMS qui ne répondait pas. Le code de la
 * cause (ECONNREFUSED, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT) l'aurait dit seul.
 */
function motifRéseau(e) {
  const code = e?.cause?.code ?? e?.cause?.message;
  return code ? `${e.message} (${code})` : e.message;
}

export function createClient({
  url,
  token,
  fetcher = fetch,
  // Injectable pour que les tests exercent les reprises sans les attendre.
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!url || !token) {
    throw new Error('DIRECTUS_URL et DIRECTUS_TOKEN sont requis pour écrire dans le CMS.');
  }

  const base = url.replace(/\/$/, '');

  async function api(method, path, body, attempt = 0, essaiRéseau = 0) {
    let res;

    try {
      res = await fetcher(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Échec de TRANSPORT : pas de réponse du tout — instance à l'arrêt, DNS,
      // TLS. Une LECTURE se rejoue sans risque, rien n'a pu être écrit.
      //
      // Une ÉCRITURE, non : la requête a pu être reçue alors que sa réponse
      // s'est perdue, et un POST rejoué créerait un item en double. Les
      // écritures ont leur filet ailleurs, à l'échelle du run — le fichier
      // reste dans inbox/, saveBrief() est conçu pour être rejoué, et le
      // workflow Rejeu relance la publication.
      if (method === 'GET' && essaiRéseau < ATTENTES_RÉSEAU.length) {
        const attente = ATTENTES_RÉSEAU[essaiRéseau];
        console.warn(
          `   (CMS injoignable : ${motifRéseau(e)} — nouvelle tentative dans ${attente / 1000} s)`
        );
        await dormir(attente);
        return api(method, path, body, attempt, essaiRéseau + 1);
      }

      throw new Error(`${method} ${path} → ${motifRéseau(e)}`, { cause: e });
    }

    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);

    // Le limiteur de débit de l'instance est serré : elle est mutualisée et
    // hébergée sur du mutualisé. On respecte l'attente qu'elle annonce plutôt
    // que de la desserrer sur le serveur, où elle le resterait.
    if (res.status === 429 && attempt < 6) {
      const entête = Number(res.headers.get('retry-after'));
      const délai = Number.isFinite(entête) && entête ? entête * 1000 + 50 : 500 * (attempt + 1);
      await dormir(délai);
      return api(method, path, body, attempt + 1, essaiRéseau);
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
export async function saveBrief(
  client,
  { brief, items, status, ingestStatus, failureReason, weather }
) {
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

  // Un relevé absent — service météo muet, ou brief recalé qu'on écrit en
  // simple trace — ne doit pas effacer celui d'un passage précédent. Même
  // principe que l'archivage des items un peu plus bas : la chaîne n'a pas le
  // droit d'effacer. On n'écrit donc la clé que lorsqu'on a de quoi la remplir.
  if (weather) charge.weather = weather;

  // Le champ « weather » est arrivé après les autres. Si l'instance ne l'a pas
  // encore — provisionnement en retard, restauration d'une sauvegarde
  // antérieure —, Directus refuse la charge ENTIÈRE : le brief du jour serait
  // perdu pour un encadré d'agrément. On réessaie donc une fois sans lui.
  //
  // « La météo ne recale jamais un brief » vaut aussi à l'écriture, et c'est le
  // seul endroit où cette promesse pouvait encore être trahie.
  const écrire = async (méthode, chemin) => {
    try {
      return await client[méthode](chemin, charge);
    } catch (e) {
      // Une panne de TRANSPORT ne se rejoue pas, et la règle n'est pas à moi :
      // la requête a pu être reçue alors que sa réponse s'est perdue, et un
      // POST rejoué créerait un brief en double. Le client marque ce cas d'une
      // `cause` ; un refus de Directus, lui, n'en a pas. Seul ce dernier peut
      // venir d'un champ qu'il ne connaît pas.
      if (e.cause || !charge.weather) throw e;
      console.warn(`   (météo non écrite, brief conservé : ${e.message})`);
      delete charge.weather;
      return client[méthode](chemin, charge);
    }
  };

  const existant = await briefForDate(client, brief.date);
  let id;

  if (existant) {
    await écrire('patch', `/items/${BRIEFS}/${existant.id}`);
    id = existant.id;

    const anciens = await client.get(
      `/items/${ITEMS}?filter[brief][_eq]=${id}&filter[status][_neq]=archived&fields=id&limit=-1`
    );
    for (const ancien of anciens ?? []) {
      await client.patch(`/items/${ITEMS}/${ancien.id}`, { status: 'archived' });
    }
  } else {
    const créé = await écrire('post', `/items/${BRIEFS}`);
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
