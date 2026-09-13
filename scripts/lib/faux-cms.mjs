// Un CMS de pacotille, pour construire le site sans Directus.
//
// Le site refuse — à raison — de se construire sans ses sources, et src/ ne se
// teste pas hors d'Astro. Il restait donc un trou : une page qui casse ne se
// voyait qu'au déploiement du matin. Ce module sert trois collections lues
// depuis une fixture, sur un port local, le temps d'un build : assez pour que
// chaque page et chaque flux prouvent qu'ils sortent encore.
//
// CE N'EST PAS UN REPLI, et il ne doit jamais le devenir : rien ici ne doit
// être joignable depuis un build de production. Il ne connaît que 127.0.0.1,
// et c'est le contrôle de rendu qui le lance, jamais la Publication.

import http from 'node:http';
import { readFile } from 'node:fs/promises';

import { seoulToday, jourPlus } from '../../shared/date.mjs';

/**
 * Les données servies : un brief avec météo et change, ses items, et des
 * événements posés autour d'aujourd'hui — un en cours, un qui finit bientôt,
 * un à venir, un terminé qui ne doit pas paraître.
 */
export async function donnéesDeDémonstration(cheminFixture) {
  const brief = JSON.parse(await readFile(cheminFixture, 'utf8'));
  const today = seoulToday();

  const briefs = [
    {
      id: 1,
      date: brief.date,
      slug: `brief-${brief.date}`,
      title: brief.title,
      standfirst: brief.standfirst,
      ingested_at: `${brief.date}T22:00:00.000Z`,
      weather: { date: brief.date, tmin: 18, tmax: 27, code: 2, precip_probability: 30, source: 'open-meteo' },
      fx: { date: brief.date, rate_date: brief.date, base: 'CHF', quote: 'KRW', rate: 1646.98, source: 'frankfurter' },
      empty_notes: null,
    },
  ];

  let n = 0;
  const items = brief.sections.flatMap((section) =>
    section.items.map((item) => ({
      id: ++n,
      brief: 1,
      section: section.key,
      ...item,
      analysis: item.analysis ?? null,
      source_lang: item.source_lang ?? null,
      published_at: item.published_at ?? null,
    }))
  );

  const base = { brief: 1, ...brief.events[0], map_url: null, booking_url: null, date_created: `${today}T00:00:00.000Z` };
  const events = [
    { ...base, id: 1, ...brief.events[0], start_date: jourPlus(today, -12), end_date: jourPlus(today, 30) },
    { ...base, id: 2, name: 'Exposition Jujutsu Kaisen', kind: 'exposition', theme: 'anime', venue: '더현대 서울', area: 'Yeouido', start_date: jourPlus(today, -20), end_date: jourPlus(today, 3) },
    { ...base, id: 3, name: 'Concert aespa', kind: 'concert', theme: 'kpop', venue: 'KSPO돔', area: 'Jamsil', start_date: jourPlus(today, 6), end_date: jourPlus(today, 7) },
    { ...base, id: 4, name: 'Café Nintendo', kind: 'popup', theme: 'gaming', venue: '롯데월드몰', area: 'Jamsil', start_date: today, end_date: today },
    { ...base, id: 5, name: 'Terminé, ne doit pas paraître', start_date: jourPlus(today, -30), end_date: jourPlus(today, -1) },
  ];

  return { briefs, items, events };
}

/**
 * Démarre le serveur sur un port libre de 127.0.0.1.
 *
 * Il honore ce que content.js demande vraiment — la pagination, et le filtre
 * de date de fin sur les événements — et ignore le reste : un faux qui
 * imiterait toute l'API Directus serait un second CMS à maintenir.
 *
 * @returns {Promise<{url: string, fermer: () => Promise<void>}>}
 */
export function démarrerLeFauxCms({ briefs, items, events }) {
  const serveur = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://faux');
    let data = [];

    if (url.pathname === '/items/mat_briefs') data = briefs;
    else if (url.pathname === '/items/mat_news_items') data = items;
    else if (url.pathname === '/items/mat_events') {
      const depuis = url.searchParams.get('filter[end_date][_gte]');
      data = events.filter((e) => !depuis || e.end_date >= depuis);
    } else {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: `collection inconnue du faux CMS : ${url.pathname}` }] }));
      return;
    }

    const page = Number(url.searchParams.get('page') ?? 1);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: page === 1 ? data : [] }));
  });

  return new Promise((résoudre) => {
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (serveur.address());
      résoudre({
        url: `http://127.0.0.1:${port}`,
        fermer: () => new Promise((ok) => serveur.close(() => ok())),
      });
    });
  });
}
