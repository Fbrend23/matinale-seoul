// Horodatage de la mise en ligne, publié par le site lui-même.
//
// Transposé du site de la compagnie, pour la même raison : un job vert ne prouve
// pas que le serveur a reçu les fichiers. Ce fichier, si — il est exclu du
// mirror et envoyé seul, en dernier. Le voir changer prouve que tout le reste
// est déjà en place ; dans le mirror il aurait suivi --parallel=4 et aurait pu
// être déposé en premier.
//
// GITHUB_SHA et GITHUB_RUN_ID viennent d'Actions. Leur absence en local est une
// information : ce build ne vient pas de la CI.

import process from 'node:process';

export function GET() {
  const build = {
    built_at: new Date().toISOString(),
    sha: process.env.GITHUB_SHA ?? null,
    run_id: process.env.GITHUB_RUN_ID ?? null,
  };

  return new Response(`${JSON.stringify(build, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
