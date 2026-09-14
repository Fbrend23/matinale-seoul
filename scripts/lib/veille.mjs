// La veille : les flux RSS des rédactions connues, relevés AVANT la session de
// rédaction, pour que l'agent lise des titres au lieu de les chercher.
//
// POURQUOI. Une session qui cherche coûte au carré : chaque résultat de
// recherche reste dans son contexte, et chaque tour suivant le relit. Celle du
// 14 septembre 2026 a fait cent vingt-six appels web pour onze items, sept fois
// le coût de celle du 7. Or ce qu'elle cherchait, les rédactions le publient
// dans un flux : titre, adresse, heure, extrait. Un script les lit en trois
// secondes, sans modèle, et l'agent n'a plus qu'à choisir puis ouvrir les
// articles retenus. Yonhap, Ars Technica, PC Gamer, qui refusent le fetch de
// la session, répondent à leur flux.
//
// Ce module ne fait que lire et mettre en forme. Il ne juge rien : le contrôle
// avant vol vérifie chaque lien derrière, et l'allowlist reste la seule
// autorité, d'où le test qui tient config/flux.json dans sources.json.
//
// Les flux se lisent à la regex, pas avec un analyseur XML : RSS 2.0 et Atom
// n'ont ici que cinq champs utiles, et une dépendance de plus sur le chemin
// critique de la parution serait une panne de plus possible.

const SEOUL = 'Asia/Seoul';

// Les entités nommées que les flux emploient vraiment, relevées sur les flux de
// config/flux.json. Une entité inconnue reste telle quelle : c'est visible,
// donc corrigeable, alors qu'une table « complète » cacherait ce qu'elle rate.
const ENTITÉS = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ecirc: 'ê', ugrave: 'ù',
  copy: '©', reg: '®', trade: '™', euro: '€', laquo: '«', raquo: '»',
};

/**
 * Décode ce qu'un flux peut mettre dans un titre : CDATA, balises, entités.
 *
 * Deux passes d'entités, et dans cet ordre : une description en CDATA porte du
 * HTML dont le texte est lui-même encodé (`&amp;rsquo;`), et un flux sans
 * CDATA encode les balises (`&lt;p&gt;`), qu'il faut d'abord décoder puis
 * retirer. D'où : CDATA, entités, balises, entités.
 */
function texte(brut = '') {
  const entités = (t) =>
    t
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, nom) => ENTITÉS[nom.toLowerCase()] ?? m);
  return entités(entités(brut.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const balise = (bloc, nom) => {
  const m = bloc.match(new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i'));
  return m ? texte(m[1]) : '';
};

/**
 * Les entrées d'un flux, RSS 2.0 (`<item>`) ou Atom (`<entry>`), sans filtre.
 *
 * Une entrée sans adresse ou sans titre est ignorée : la veille ne propose que
 * ce qui peut devenir une `source_url`. Une entrée sans date est gardée avec
 * `date: null`, c'est le filtre de fraîcheur qui décidera de son sort.
 *
 * @param {string} xml
 * @returns {{ title: string, url: string, date: Date|null, extrait: string }[]}
 */
export function analyserFlux(xml) {
  const blocs = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  const entrées = [];
  for (const bloc of blocs) {
    const title = balise(bloc, 'title');
    // RSS met l'adresse dans <link>…</link> ; Atom dans <link href="…"/>.
    const href = bloc.match(/<link[^>]*\shref="([^"]+)"/i)?.[1];
    const url = texte(href ?? balise(bloc, 'link'));
    if (!title || !/^https?:\/\//.test(url)) continue;

    const quand = balise(bloc, 'pubDate') || balise(bloc, 'published') || balise(bloc, 'updated') || balise(bloc, 'dc:date');
    const date = quand && !Number.isNaN(Date.parse(quand)) ? new Date(quand) : null;

    const extrait = texte(balise(bloc, 'description') || balise(bloc, 'summary') || balise(bloc, 'content')).slice(0, 160);
    entrées.push({ title, url, date, extrait });
  }
  return entrées;
}

/**
 * Ne garder que ce qui est paru dans les `heures` dernières heures, du plus
 * récent au plus ancien. Une entrée sans date est écartée : la veille dit
 * « paru depuis », elle ne peut pas le dire d'un article qu'elle ne sait pas
 * dater, et l'agent aurait à le vérifier, ce qui est l'appel qu'on lui épargne.
 */
export function récents(entrées, { maintenant = new Date(), heures = 30 } = {}) {
  const depuis = maintenant.getTime() - heures * 3_600_000;
  return entrées
    .filter((e) => e.date && e.date.getTime() >= depuis && e.date.getTime() <= maintenant.getTime() + 3_600_000)
    .sort((a, b) => b.date - a.date);
}

/**
 * Une date en ISO 8601, à l'heure de Séoul, avec son décalage : la forme
 * exacte que `published_at` attend. L'agent la recopie, il ne la calcule pas.
 * Séoul ne change pas d'heure, le décalage est constant.
 */
export function isoSéoul(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SEOUL,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

/**
 * Relever tous les flux. Un flux en panne est un flux en moins, jamais une
 * veille en moins : il est rapporté dans `pannes` et la veille se fait sans.
 *
 * @param {object[]} flux         config/flux.json
 * @param {object} [p]
 * @param {Function} [p.fetcher]   injectable, comme partout ailleurs
 * @param {number} [p.timeoutMs]
 * @param {Date} [p.maintenant]
 * @param {number} [p.heures]
 * @param {number} [p.max]         par flux, pour que Yonhap n'écrase pas le reste
 */
export async function releverVeille(
  flux,
  { fetcher = fetch, timeoutMs = 15_000, maintenant = new Date(), heures = 30, max = 30 } = {}
) {
  const relevés = await Promise.all(
    flux.map(async (f) => {
      const controller = new AbortController();
      const minuteur = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher(f.url, {
          signal: controller.signal,
          headers: { 'user-agent': 'Mozilla/5.0 (matinale-seoul; veille RSS)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        });
        if (!res.ok) return { ...f, entrées: [], panne: `HTTP ${res.status}` };
        const entrées = récents(analyserFlux(await res.text()), { maintenant, heures }).slice(0, max);
        return { ...f, entrées, panne: null };
      } catch (e) {
        return { ...f, entrées: [], panne: e.name === 'AbortError' ? `délai de ${timeoutMs} ms dépassé` : e.message };
      } finally {
        clearTimeout(minuteur);
      }
    })
  );
  return { relevés, pannes: relevés.filter((r) => r.panne).map((r) => `${r.source_name} : ${r.panne}`) };
}

/**
 * La veille en Markdown, pour l'agent. Compacte : chaque ligne est relue à
 * chaque tour de la session, et c'est le prix de ce fichier qui a justifié
 * de l'écrire.
 *
 * `recent` et `evenements` sont les JSON du site (`/api/recent.json`,
 * `/api/evenements.json`), rendus ici en deux listes plutôt que déposés bruts :
 * l'agent n'a besoin que des titres et des dates, et le JSON entier pèse cinq
 * fois plus. `null` quand le site n'a pas répondu, et la veille le dit, pour
 * que l'agent aille chercher lui-même.
 */
export function rendreVeille(
  { relevés, pannes },
  { jour, maintenant = new Date(), heures = 30, recent = null, evenements = null }
) {
  const lignes = [
    `# Veille du ${jour} (heure de Séoul), relevée le ${isoSéoul(maintenant)}`,
    '',
    '## Déjà couvert par le site (quatorze derniers briefs)',
    '',
    '`/api/recent.json`, résumé aux titres. Une histoire qui figure ici ne se couvre pas une seconde fois.',
    '',
  ];
  if (recent?.briefs) {
    for (const b of recent.briefs) {
      for (const h of b.headlines ?? []) lignes.push(`- ${b.date} · ${h.section} · ${h.headline}`);
    }
  } else {
    lignes.push('Site injoignable ce matin : récupère `/api/recent.json` toi-même, une fois.');
  }
  lignes.push('', "## Déjà dans l'onglet événements", '', '`/api/evenements.json`, résumé. Ne repropose que si les dates ont changé.', '');
  if (evenements?.events) {
    for (const e of evenements.events) {
      lignes.push(`- ${e.start_date} → ${e.end_date} · ${e.theme} · ${e.name} · ${e.venue ?? ''}`.trimEnd());
    }
  } else {
    lignes.push('Site injoignable ce matin : récupère `/api/evenements.json` toi-même, une fois.');
  }
  lignes.push(
    '',
    `## Titres parus depuis ${heures} heures`,
    '',
    'Flux des rédactions connues, du plus récent au plus ancien. Chaque adresse est une adresse vue : elle peut servir de `source_url` telle quelle, et son heure de `published_at`.',
    "L'extrait sert à choisir, pas à résumer : ouvre l'article retenu avant de l'écrire.",
    ''
  );
  for (const r of relevés) {
    const n = r.entrées.length;
    lignes.push(`### ${r.source_name} (${r.lang}) · ${r.pour.join(', ')} · ${r.panne ? `injoignable (${r.panne})` : `${n} titre${n > 1 ? 's' : ''}`}`);
    lignes.push('');
    for (const e of r.entrées) {
      lignes.push(`- ${isoSéoul(e.date)} · ${e.title}`);
      lignes.push(`  ${e.url}`);
      if (e.extrait) lignes.push(`  ${e.extrait}`);
    }
    lignes.push('');
  }
  if (pannes.length) {
    lignes.push(`Flux injoignables ce matin : ${pannes.join(' ; ')}. Pour ces rédactions, cherche toi-même, avec le budget du prompt.`);
    lignes.push('');
  }
  return lignes.join('\n');
}
