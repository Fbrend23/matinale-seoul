// @ts-check
import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Fourni par le workflow. Sans lui, le sitemap et le flux RSS porteraient des
  // adresses locales : des URL fausses sur un site qui, lui, se construirait
  // parfaitement. En développement, localhost est la bonne réponse.
  site: process.env.SITE_URL ?? 'http://localhost:4321',

  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [sitemap()],

  // Les deux variables ne sont PAS optionnelles, à la différence du site de la
  // compagnie : la Matinale n'a pas de contenu local sur lequel retomber, et
  // c'est voulu. Sans source, le build doit s'arrêter — `astro:env` le fait
  // mécaniquement, avant même la première requête.
  env: {
    schema: {
      DIRECTUS_URL: envField.string({ context: 'server', access: 'public' }),
      // `access: 'secret'` fait échouer le build si le jeton est référencé
      // depuis du code client. Une garde mécanique, plus sûre que la discipline.
      DIRECTUS_TOKEN: envField.string({ context: 'server', access: 'secret' }),
    },
  },
});
