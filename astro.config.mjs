// @ts-check
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// L'index de la recherche, construit sur le site fini.
//
// Une intégration et non un script npm « postbuild » : le contrôle de rendu
// lance astro directement, avec son propre --outDir, et un script npm n'y
// tournerait pas. Le hook, lui, reçoit le dossier réel, quel que soit celui
// qui construit. Pagefind lit les pages qui portent data-pagefind-body, les
// briefs, et n'écrit que des fichiers : le site reste entièrement statique.
//
// Un index qui échoue fait échouer le build : un site sans recherche n'est
// pas une panne de publication, mais un hook qui avalerait l'erreur serait un
// silence, et c'est le silence que toute la chaîne cherche à fermer.
//
// En développement, `astro dev` ne construit rien : le serveur sert alors les
// fichiers de /pagefind/ du DERNIER build, s'il y en a un. La recherche porte
// donc sur l'index d'hier, ce qui suffit pour la regarder ; sans build, la
// page reste sur sa phrase de repli, et le journal dit pourquoi.
function pagefind() {
  let outDir = '';
  return {
    name: 'pagefind',
    hooks: {
      'astro:config:done': ({ config }) => {
        outDir = fileURLToPath(config.outDir);
      },
      'astro:server:setup': ({ server, logger }) => {
        const dossier = path.join(outDir, 'pagefind');
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
        let prévenu = false;
        server.middlewares.use('/pagefind', async (req, res, next) => {
          const { readFile } = await import('node:fs/promises');
          const relatif = decodeURIComponent((req.url ?? '/').split('?')[0]);
          const fichier = path.normalize(path.join(dossier, relatif));
          if (!fichier.startsWith(dossier)) return next();
          try {
            const corps = await readFile(fichier);
            res.setHeader('Content-Type', types[path.extname(fichier)] ?? 'application/octet-stream');
            res.end(corps);
          } catch {
            // Le composant est le premier fichier que la page demande : s'il
            // manque, c'est qu'il n'y a pas eu de build, et on le dit une fois.
            if (!prévenu && relatif === '/pagefind-ui.js') {
              prévenu = true;
              logger.warn('pas d’index de recherche : `npm run build` une fois, le serveur de dev servira le sien');
            }
            next();
          }
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const { createIndex, close } = await import('pagefind');
        const dossier = fileURLToPath(dir);
        const { index, errors } = await createIndex();
        if (!index) throw new Error(`Pagefind : ${errors.join(' ; ')}`);
        const { page_count, errors: fautes } = await index.addDirectory({ path: dossier });
        if (fautes.length) throw new Error(`Pagefind : ${fautes.join(' ; ')}`);
        await index.writeFiles({ outputPath: path.join(dossier, 'pagefind') });
        await close();
        logger.info(`index de recherche écrit, ${page_count} page(s) parcourue(s)`);
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  // Fourni par le workflow. Sans lui, le sitemap et le flux RSS porteraient des
  // adresses locales : des URL fausses sur un site qui, lui, se construirait
  // parfaitement. En développement, localhost est la bonne réponse.
  site: process.env.SITE_URL ?? 'http://localhost:4321',

  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [sitemap(), pagefind()],

  // Les deux variables ne sont PAS optionnelles, à la différence du site de la
  // compagnie : la Matinale n'a pas de contenu local sur lequel retomber, et
  // c'est voulu. Sans source, le build doit s'arrêter, `astro:env` le fait
  // mécaniquement, avant même la première requête.
  env: {
    schema: {
      DIRECTUS_URL: envField.string({ context: 'server', access: 'public' }),
      // `access: 'secret'` fait échouer le build si le jeton est référencé
      // depuis du code client. Une garde mécanique, plus sûre que la discipline.
      DIRECTUS_TOKEN: envField.string({ context: 'server', access: 'secret' }),
      // La clé JavaScript de Kakao Maps, elle, est facultative et publique :
      // elle n'ouvre que la carte de la page Événements, et Kakao la
      // restreint aux domaines déclarés. Sans elle, la page se construit sans
      // le bloc carte, et le contrôle de rendu tourne sans compte Kakao.
      KAKAO_MAPS_APP_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
    },
  },
});
