// Flux RSS des événements : un élément par événement, pas un par brief.
//
// L'inverse du flux des briefs, et pour la raison inverse : on suit ce flux
// pour être prévenu de CHAQUE nouveau pop-up, pas pour lire une parution. Un
// élément stable par événement — même identifiant, même date d'un build à
// l'autre — pour qu'un lecteur ne le renotifie pas chaque matin.
//
// Ce qui est fini sort du flux avec la page ; le lecteur garde ce qu'il a lu.

import rss from '@astrojs/rss';
import { listEvents } from '../lib/content.js';
import { dateRange } from '../lib/date.js';
import { escapeHtml } from '../lib/html.js';
import { KIND_LABELS, THEME_LABELS, THEMES_EN_PROSE, lienNaverMap } from '../../shared/evenements.mjs';

export async function GET(context) {
  const events = await listEvents();

  // Du plus récemment repéré au plus ancien : c'est l'ordre d'un flux.
  const parArrivée = [...events].sort((a, b) => String(b.date_created).localeCompare(String(a.date_created)));

  return rss({
    title: 'La Matinale de Séoul — Pop-ups & événements',
    description:
      `Pop-ups, concerts, expositions et salons à Séoul — ${THEMES_EN_PROSE}. ` +
      'Un élément par événement, repéré automatiquement ; dates et liens à vérifier.',
    site: context.site,
    // Le site pose une barre finale sur chaque adresse, et le flux la poserait
    // aussi — après l'ancre, ce qui la casserait. On l'écrit soi-même.
    trailingSlash: false,
    customData: '<language>fr</language>',
    items: parArrivée.map((event) => {
      const lieu = `${event.venue}, ${event.area}`;
      const carte = event.map_url ?? lienNaverMap(event);
      return {
        title: `${event.name} — ${dateRange(event.start_date, event.end_date)}`,
        link: `/evenements/#evenement-${event.id}`,
        // Quand l'ingestion l'a écrit, pas quand il commence : un lecteur veut
        // savoir qu'un pop-up est annoncé, pas attendre son premier jour.
        pubDate: new Date(event.date_created),
        description: `${lieu}. ${event.summary}`,
        categories: [THEME_LABELS[event.theme] ?? event.theme, KIND_LABELS[event.kind] ?? event.kind],
        content: [
          `<p><strong>${escapeHtml(dateRange(event.start_date, event.end_date))}</strong> — ${escapeHtml(lieu)}</p>`,
          `<p>${escapeHtml(THEME_LABELS[event.theme] ?? event.theme)} · ${escapeHtml(KIND_LABELS[event.kind] ?? event.kind)}</p>`,
          `<p>${escapeHtml(event.summary)}</p>`,
          '<p>' +
            `<a href="${escapeHtml(carte)}">Voir sur Naver Map</a>` +
            (event.booking_url ? ` · <a href="${escapeHtml(event.booking_url)}">Réserver</a>` : '') +
            ` · Source : <a href="${escapeHtml(event.source_url)}">${escapeHtml(event.source_name)}</a>` +
            '</p>',
          '<p><em>Événement repéré automatiquement ; dates et liens à vérifier auprès de la source.</em></p>',
        ].join(''),
      };
    }),
  });
}
