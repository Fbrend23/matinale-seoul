# Cahier des charges — La Matinale de Séoul (v2)

Remplace la v1, rédigée sans accès au dépôt. Cette version intègre l'état des lieux et tranche
les cinq écarts relevés. Elle reste subordonnée au dépôt : en cas de contradiction, signale
l'écart plutôt que de réécrire l'existant.

---

## 1. Ce qui est acquis

- **Directus 12** tourne déjà sur une instance mutualisée provisionnée par `platform-cms`.
  La Matinale n'est pas un CMS à monter : c'est **un client de plus à provisionner**
  (`clients/matinale.json` + `npm run provision`). Préfixe : `mat_`.
- Hébergement : « Site Node.js » Infomaniak lançant `directus start`. Enveloppe serrée et
  assumée (384 Mo, pool DB à 3, WebSockets coupés) — ne rien y ajouter de gourmand.
- Base : MariaDB Infomaniak, `DB_CLIENT=mysql`.
- **Le snapshot de schéma est une sauvegarde, jamais un gabarit.** `directus schema apply`
  réconcilie l'instance entière et supprimerait les collections des autres clients. Ne jamais
  l'exécuter. La source de vérité par client est la fiche JSON déclarative jouée par
  `provision-client.mjs` via l'API, idempotente.
- Modèle frontend réutilisable : Maisallezfieu — Astro statique, `@astrojs/sitemap`,
  `scripts/fetch-media.mjs`, tests joués deux fois (TZ local et UTC), déploiement FTPS par `lftp`
  avec ses trois gardes (marqueur `.deploy-cible`, refus de builder sans secrets, `build.json`
  envoyé seul et en dernier). Transposer, ne pas réinventer.

### À faire avant toute autre chose

1. **Écrire `.gitignore`.** Le `.env` existe, n'est pas suivi, et rien ne le protège d'un
   `git add .`. Premier commit, avant le reste.
2. **Vérifier qu'un connecteur GitHub est attachable à la tâche Claude planifiée.** Toute
   l'architecture en dépend (section 3). Une tâche Claude écrit via ses connecteurs, elle ne fait
   pas d'appel HTTP arbitraire. Si le connecteur n'existe pas : repli sur Google Drive avec un
   workflow planifié qui va chercher le fichier pour le committer. **Test à blanc avant d'écrire
   une ligne d'ingestion.**
3. `node scripts/check-db.mjs` pour relever la version de MariaDB.
4. Retirer le `repository_dispatch: [cms-publish]` mort du `deploy.yml` de Maisallezfieu.
   Un déclencheur qui écoute dans le vide finit par être réactivé par erreur.

---

## 2. Objectif

Publier automatiquement, chaque matin, un brief d'actualité en français : tourisme en
Corée, actualités coréennes générales, tech et IA mondiales, jeu vidéo mondial. Contenu
produit par une tâche planifiée Claude qui cherche sur le web et rend un JSON structuré.

Aucune relecture humaine avant mise en ligne — la qualité repose sur les cinq gardes (section 6).

Volume : un brief par jour, week-end compris, quatre rubriques, 12 à 24 items. Charge négligeable, ne
surdimensionne rien.

---

## 3. Architecture

```
Tâche Claude planifiée (6h, Asia/Seoul)
        │  commit  inbox/brief-YYYY-MM-DD.json
        ▼
GitHub  ──push (paths: inbox/**)──▶  Actions
                                       │
                                       ├─ valider le nom + le schéma
                                       ├─ 5 gardes
                                       ├─ écrire dans Directus (cms.<domaine>)
                                       ├─ build Astro
                                       ├─ déploiement FTPS ──▶ matinale.<domaine>
                                       └─ commit : inbox/ → archive/
```

**Pas de cron.** Le push déclenche le workflow. Pas de scheduling à configurer, pas de script qui
tourne dans le vide, et le rejeu d'un run raté est un bouton dans l'onglet Actions, avec ses logs.

**Pas de webhook de build.** Il n'y a pas de pièce intermédiaire : le workflow enchaîne ingestion
et build dans le même job. Le `workflow_dispatch` existant reste en place, inchangé, pour le seul
bouton « Mettre le site en ligne » posé sur `mat_publication`.

Site **entièrement statique**. Pas de SSR, pas d'ISR, pas de base côté public.

### Permissions du jeton de la tâche

PAT fine-grained, scopé au seul dépôt, `Contents: write`. Le dépôt avait écarté
`repository_dispatch` pour ne pas accorder ce droit ; la différence ici est que le jeton n'est pas
dans le CMS mutualisé mais porté par une tâche isolée. Et surtout : un PAT fine-grained avec
`Contents: write` **ne peut pas modifier `.github/workflows/`** — cela exige la permission
`Workflows`, séparée, qu'on n'accorde pas. L'agent dépose du contenu, il ne peut pas altérer la
chaîne qui le valide.

Deux garde-fous complémentaires : déclenchement restreint à `paths: inbox/**`, et rejet de tout
fichier dont le nom ne correspond pas à `brief-YYYY-MM-DD.json`.

---

## 4. Modèle de données — fiche client `mat_`

### `mat_briefs`
| champ | type | notes |
|---|---|---|
| `status` | système | `draft` \| `published` \| `archived` — **ne pas toucher.** La policy de build ne lit que `published` |
| `date` | date | `unique: true` — porte l'idempotence |
| `title` | string | |
| `standfirst` | text | |
| `slug` | string | `unique: true` |
| `ingest_status` | enum | `ok` \| `failed` — traçabilité, distinct du champ système |
| `failure_reason` | text | nullable |
| `ingested_at` | timestamp | |
| `weather` | json | nullable — bulletin Open-Meteo figé à l'ingestion. Jamais écrasé par un rejeu, et sans droit de veto sur la publication |
| `empty_notes` | json | nullable — pourquoi telle rubrique est vide, une phrase par rubrique concernée, indexée par sa clé. Celle de l'agent, ou celle de l'ingestion quand les gardes ont retiré tous les items. Jamais écrasé par un rejeu muet |

Un brief recalé reste en `draft`, ce qui est déjà fonctionnellement l'échec puisque le build
ne lit que `published`. Zéro cas particulier dans le filtre, la Matinale reste dans la convention.

### `mat_news_items`
| champ | type | notes |
|---|---|---|
| `status` | système | idem |
| `brief` | m2o → `mat_briefs` | **à implémenter dans `provision-client.mjs`** (voir ci-dessous) |
| `section` | string + `meta.options` | `tourisme` \| `coree` \| `tech` \| `gaming` |
| `headline` | string | |
| `summary` | text | 40 mots max |
| `analysis` | text | nullable, un seul non-null par section |
| `importance` | integer | 1 = plus important, dans sa section |
| `tags` | json | **tableau de chaînes, pas de m2m en v1** |
| `source_name` | string | |
| `source_url` | string | |
| `source_lang` | string | code ISO |
| `published_at` | timestamp | nullable |
| `link_checked_at` | timestamp | rempli par la garde n°2 |

### `mat_events`

Ajoutée après coup, pour l'onglet « Pop-ups & événements ». Un événement dure
au-delà du brief qui l'a repéré : il ne peut pas vivre dans `mat_news_items`.

| champ | type | notes |
|---|---|---|
| `status` | système | idem ; l'ingestion archive ce dont `end_date` est passée, à chaque run |
| `brief` | m2o → `mat_briefs` | **non requis** : un événement survit à son brief |
| `name` | string | |
| `kind` | string + `meta.options` | `popup` \| `concert` \| `exposition` \| `festival` \| `salon` \| `autre` |
| `theme` | string + `meta.options` | `anime` \| `pokemon` \| `kpop` \| `gaming` — pas de « autre » |
| `venue`, `area` | string | le lieu tel qu'on le cherche sur Naver Map, et le quartier |
| `start_date`, `end_date` | date | fin incluse, obligatoire : c'est elle qui sort l'événement de la page |
| `summary` | text | 40 mots max |
| `source_name`, `source_url`, `source_lang` | string | comme un item ; `source_url` vérifiée et soumise à l'allowlist |
| `booking_url`, `map_url` | string | nullables ; vérifiés, un lien mort retire le champ, pas l'événement. `map_url` n'est pas une source : hors allowlist |
| `link_checked_at` | timestamp | rempli par la sonde de la source |

### Trois développements dans `provision-client.mjs`

Déclaratifs, jamais à la main dans l'interface : l'instance est mutualisée, ce qui n'est pas dans
les scripts ne survit pas au client suivant.

1. **Relation m2o entre collections client.** Le provisionneur ne sait créer qu'une relation vers
   `directus_files`. C'est le seul des trois qui bloque le modèle. À faire en premier.
2. **Policy d'écriture limitée.** Troisième policy, générique, à côté d'éditeur et lecture-build :
   écriture restreinte aux collections du client. Pas de jeton admin dans une chaîne automatisée.
3. **Passthrough de `meta.options`.** Petit, et sert tous les clients futurs. Mais l'intégrité de
   `section` vient du validateur JSON, pas de Directus : l'enum n'est là que pour le confort du
   chemin de correction manuelle. **À faire en dernier.**

Le m2m `tags` est écarté pour la v1 : les pages par tag s'agrègent au build depuis les tableaux
JSON. On ajoutera le support des tables de jonction au provisionneur quand un client en aura
réellement besoin.

Après provisionnement : `npm run schema:snapshot` et commiter — comme sauvegarde.

---

## 5. Contrat de sortie de l'agent

Fichier `inbox/brief-YYYY-MM-DD.json`, contenant uniquement ce JSON :

```json
{
  "date": "2026-09-04",
  "title": "…",
  "standfirst": "…",
  "sections": [
    {
      "key": "tourisme",
      "empty_note": null,
      "items": [
        {
          "headline": "…",
          "summary": "…",
          "analysis": "…",
          "importance": 1,
          "tags": ["k-eta", "immigration"],
          "source_name": "Yonhap",
          "source_url": "https://…",
          "source_lang": "ko",
          "published_at": "2026-09-03T21:10:00+09:00"
        }
      ]
    }
  ]
}
```

Prose en français, noms de champs en anglais. Les quatre `key` toujours présentes, même vides
(`items: []` + `empty_note` en une phrase française). `analysis` non-null pour au plus un item par
section. `published_at` omis si la source ne donne pas d'horodatage fiable.

Le champ `status` a disparu du contrat : il est décidé par l'ingestion, pas par l'agent.

Le fichier peut porter un tableau `events` facultatif — voir `$defs/event` dans le
schéma. Ce n'est pas une cinquième rubrique : les quatre `key` restent seules dans
`sections`, et `events` vit à la racine.

Écrire `schemas/brief.schema.json` et valider contre lui.

---

## 6. Les cinq gardes

Elles remplacent la relecture humaine. Ordre d'exécution :

1. **Schéma** — validation contre `brief.schema.json`. Échec ⇒ brief entier recalé.
2. **Liens vivants** — HEAD sur chaque `source_url`, timeout 10 s, redirections suivies, repli GET
   si le serveur conteste la méthode. *La garde la plus rentable : elle attrape les URL inventées,
   mode de défaillance le plus probable.* Trois verdicts, parce que la question posée est « cette
   adresse existe-t-elle ? » et non « ai-je pu la lire ? » : 2xx ⇒ l'item passe, daté ;
   401/403/406/429 ⇒ **l'item passe sans date**, un refus d'accès ne prouvant pas une invention ;
   404, 5xx ou silence ⇒ l'item saute.
3. **Allowlist de domaines** — `config/sources.json`, éditable. Domaine inconnu ⇒ item conservé
   mais brief laissé en `draft` (pas jeté : c'est ainsi que la liste s'enrichit).
4. **Doublons** — similarité du `headline` contre les 14 derniers jours, seuil 0,85.
5. **Cohérence** — `date` = aujourd'hui à Séoul ; au moins deux sections non vides ;
   `summary` ≤ 40 mots ; `importance` sans doublon dans une section.

**Échec.** Item recalé ⇒ retiré, le brief part sans lui. Brief recalé ⇒ écrit en `draft` avec
`ingest_status: failed` et `failure_reason`, le workflow sort en erreur (mail GitHub automatique),
le fichier reste dans `inbox/` pour rejeu.

**Idempotence.** Si un brief `published` existe déjà pour cette date, l'ingestion s'arrête sans
rien écrire et le workflow sort en succès.

**Les événements ne sont pas une sixième garde.** Chaque événement passe ses propres contrôles
— dates réelles, fin ≥ début, fin ≥ aujourd'hui, 40 mots, allowlist, doublons contre les
événements actifs, source vivante — et ce qui échoue est **écarté** avec un `::warning::`,
jamais le brief : un domaine inconnu écarte au lieu de retenir en brouillon, une collection
absente est un avertissement. Ils sont écrits après le brief, rattachés à lui, toujours
`published`. À chaque run, ce dont `end_date` est passée est archivé.

---

## 7. Sémantique de l'échec

Distinction à tenir strictement — c'est le fil conducteur de la chaîne :

- **« Pas de brief aujourd'hui »** : cas de contenu normal. La page rend, datée explicitement.
  Build vert.
- **« Directus injoignable » ou zéro brief remonté** : échec de build, bruyant. Rien n'est déployé.

Un build privé de ses sources doit échouer, jamais retomber en silence sur des données figées.
Le bénéfice tombe tout seul : quand le build échoue, le déploiement précédent reste en ligne. Le
site n'est jamais vide sans qu'on serve jamais du figé en silence.

---

## 8. Garde-fous éditoriaux

- Un brief qui passe les cinq gardes est publié directement, sans validation.
- **Chemin de correction** : Directus reste accessible. Une correction manuelle se met en ligne
  par le bouton « Mettre le site en ligne » existant. Automatique ne veut pas dire figé.
- **Mention obligatoire** en pied de chaque brief : contenu généré automatiquement, résumés
  produits par IA, sources à vérifier. Non négociable.
- **`/api/recent.json`** généré au build : headlines des 14 derniers jours. C'est ce que l'agent
  lit au début de son run pour ne pas republier une histoire déjà couverte. Servi par le site
  statique, pas par Directus, pour que l'agent tourne même CMS éteint.

---

## 9. À ne pas faire

- Ne jamais exécuter `directus schema apply` sur cette instance.
- Ne jamais stocker le texte intégral d'un article source ni sa traduction complète. Résumés
  courts en propre + lien. La différence entre une revue de presse et une contrefaçon.
- Ne jamais reconstruire, deviner ou compléter une URL. Un lien non vérifié est un item mort.
- Ne pas parser au regex la partie lisible du brief : seul le JSON fait foi.
- Ne rien configurer à la main dans l'interface Directus.

---

## 10. Ordre de travail

1. `.gitignore`, test du connecteur GitHub, `check-db.mjs`, nettoyage du `deploy.yml` mort
2. `provision-client.mjs` : relation m2o, puis policy d'écriture
3. `clients/matinale.json` + provisionnement + snapshot de sauvegarde
4. `brief.schema.json` + validateur, testé sur des fixtures dont des cas volontairement cassés
5. Script d'ingestion avec les cinq gardes
6. Workflow GitHub Actions complet, y compris le commit `inbox/` → `archive/`
7. Frontend Astro : accueil, brief du jour, archive par date, page par section, RSS,
   `recent.json`, mention IA
8. Déploiement FTPS transposé de Maisallezfieu, avec ses trois gardes
9. `meta.options` dans le provisionneur

Les phases 4 et 5 avant le frontend : sans données fiables, le site n'a rien à afficher.

---

## 11. Reste ouvert

- **Le domaine et les deux sous-domaines.** Demander à Brendan, ne pas inventer.
- La version de MariaDB, à relever en phase 1.
- Le repli Drive, à documenter seulement si le test du connecteur GitHub échoue.
