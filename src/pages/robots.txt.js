// robots.txt, produit au build pour porter l'adresse réelle du site.
//
// Un fichier statique dans public/ ne peut pas connaître SITE_URL, et un
// sitemap annoncé sous une adresse locale ne serait jamais lu. Même raison que
// rss.xml.js : ce qui dépend du domaine se génère.

export function GET({ site }) {
  const corps = [
    'User-agent: *',
    'Allow: /',
    '',
    // Le flux et le sitemap sont les deux entrées faites pour les machines.
    `Sitemap: ${new URL('sitemap-index.xml', site).href}`,
    '',
  ].join('\n');

  return new Response(corps, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
