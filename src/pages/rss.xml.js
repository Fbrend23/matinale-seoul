// Flux RSS : un élément par brief, pas un par item.
//
// Un lecteur suit une parution quotidienne, pas quinze dépêches éparses : quinze
// entrées par jour noieraient sa liste et feraient perdre le fil éditorial du
// brief. Le contenu de chaque entrée reprend les titres, avec la mention IA —
// un flux repris ailleurs doit la porter aussi.

import rss from '@astrojs/rss';
import { recentBriefs } from '../lib/content.js';
import { SECTION_LABELS, RUBRIQUES_EN_PROSE } from '../../shared/sections.mjs';

export async function GET(context) {
  const briefs = await recentBriefs(30);

  return rss({
    title: 'La Matinale de Séoul',
    description:
      `Brief quotidien — ${RUBRIQUES_EN_PROSE}. ` +
      'Contenu généré automatiquement, résumés produits par IA, sources à vérifier.',
    site: context.site,
    customData: '<language>fr</language>',
    items: briefs.map((brief) => ({
      title: brief.title,
      link: `/briefs/${brief.slug}/`,
      // Minuit à Séoul, dit en UTC : sans le décalage, un brief du 4 septembre
      // apparaîtrait daté du 3 chez les lecteurs européens.
      pubDate: new Date(`${brief.date}T00:00:00+09:00`),
      description: brief.standfirst,
      content: [
        `<p>${escapeHtml(brief.standfirst)}</p>`,
        ...brief.sections
          .filter((s) => s.items.length > 0)
          .map(
            (s) =>
              `<h2>${escapeHtml(SECTION_LABELS[s.key])}</h2><ul>` +
              s.items
                .map(
                  (i) =>
                    `<li><strong>${escapeHtml(i.headline)}</strong> — ` +
                    `${escapeHtml(i.summary)} ` +
                    `<a href="${escapeHtml(i.source_url)}">${escapeHtml(i.source_name)}</a></li>`
                )
                .join('') +
              '</ul>'
          ),
        '<p><em>Contenu généré automatiquement, résumés produits par IA, ' +
          'sources à vérifier.</em></p>',
      ].join(''),
    })),
  });
}

function escapeHtml(texte) {
  return String(texte ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
