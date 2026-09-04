// Ce que l'agent lit avant d'écrire le brief du jour.
//
// Il commence son run en récupérant ce fichier pour ne pas republier une
// histoire déjà couverte. C'est le SITE qui le sert, pas Directus : l'agent
// travaille tôt le matin, et il doit pouvoir tourner même CMS éteint. Le rendre
// dépendant du CMS ferait dépendre la production du brief de la disponibilité
// d'une machine qui, elle, n'a rien à faire à cette heure-là.
//
// La garde des doublons, elle, interroge Directus : elle tourne dans la CI, où
// le CMS est de toute façon requis. Les deux ne se remplacent pas — ce fichier
// évite le doublon, la garde l'attrape.

import { recentBriefs } from '../../lib/content.js';

export async function GET() {
  const briefs = await recentBriefs(14);

  const charge = {
    generated_at: new Date().toISOString(),
    note: "Titres des quatorze derniers briefs. À lire avant de composer le brief du jour : une histoire qui figure ici a déjà été couverte.",
    briefs: briefs.map((brief) => ({
      date: brief.date,
      title: brief.title,
      headlines: brief.sections.flatMap((section) =>
        section.items.map((item) => ({
          section: section.key,
          headline: item.headline,
          source_url: item.source_url,
        }))
      ),
    })),
  };

  return new Response(`${JSON.stringify(charge, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
