// Ce que l'agent lit avant de proposer des événements.
//
// Tout ce que le site connaît déjà, en cours ou à venir : ce qui y figure ne se
// propose pas une seconde fois. Servi par le SITE, pas par Directus, pour la
// même raison que recent.json — l'agent travaille tôt, et doit pouvoir tourner
// CMS éteint. La garde des doublons de l'ingestion, elle, interroge le CMS.

import { listEvents } from '../../lib/content.js';
import { seoulToday } from '../../lib/date.js';

export async function GET() {
  const events = await listEvents();

  const charge = {
    generated_at: new Date().toISOString(),
    today: seoulToday(),
    note: "Événements déjà connus, en cours ou à venir. À lire avant d'en proposer : un événement qui figure ici ne se propose pas une seconde fois.",
    events: events.map(({ name, kind, theme, venue, area, start_date, end_date, source_url }) => ({
      name,
      kind,
      theme,
      venue,
      area,
      start_date,
      end_date,
      source_url,
    })),
  };

  return new Response(`${JSON.stringify(charge, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
