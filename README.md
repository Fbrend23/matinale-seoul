# La Matinale de Séoul

Brief d'actualité quotidien en français : tourisme en Corée, actualités
coréennes, tech et IA, jeu vidéo. Un brief par jour, quatre rubriques,
12 à 24 items — et un onglet « Pop-ups & événements » qui liste tout ce qui se
passe à Séoul, en cours ou à venir, pour l'anime, Pokémon, la K-pop et le jeu
vidéo.

Le contenu est produit par une tâche Claude planifiée et publié **sans relecture
humaine**. Ce que la relecture aurait fait, cinq gardes automatiques le font.

| | |
|---|---|
| Site | statique, Astro 7, déployé en FTPS sur mutualisé Infomaniak |
| CMS | Directus 12 mutualisé, collections `mat_*` ([platform-cms](../platform-cms)) |
| Cahier des charges | [`cdc.md`](cdc.md) — il fait foi |

## La chaîne, du fichier au site

```
Tâche Claude planifiée (timer systemd, 7 h 30 Asia/Seoul)
        │  commit  inbox/brief-AAAA-MM-JJ.json
        ▼
GitHub ──push (paths: inbox/**)──▶ Actions
                                     ├─ nom du fichier + cinq gardes
                                     ├─ écriture dans Directus
                                     ├─ build Astro
                                     ├─ déploiement FTPS
                                     └─ commit : inbox/ → archive/AAAA/
```

**Aucun cron dans la chaîne.** Le push déclenche tout, et le site ne se
reconstruit que lorsqu'il a quelque chose de neuf à dire. Rejouer un run raté
est un bouton dans l'onglet Actions, avec ses journaux. Deux surveillances, elles,
sont bien à l'heure — `Rejeu` à 8 h 15 et 9 h 15, `Veille` à 10 h, heure de Séoul —
mais aucune des deux ne reconstruit quoi que ce soit de son propre chef.

L'avis « le brief du jour n'est pas encore paru » est la seule chose qui ne peut
pas être décidée au build : « aujourd'hui » y serait figé. Il est calculé chez le
lecteur, en quelques lignes qui réutilisent les fonctions de date du site. Sans
JavaScript, l'avis n'apparaît pas et la date du brief reste affichée en tête
d'article : elle suffit à ne tromper personne.

**Pas de webhook de build.** L'ingestion et le build sont deux étapes du même
job : il n'y a aucune pièce intermédiaire où la chaîne puisse s'arrêter en
silence.

## Quand le CMS ne répond pas

Un brief valide ne doit pas être perdu parce que Directus a hoqueté. Trois
filets, du plus court au plus long :

| durée de la panne | ce qui rattrape | où |
|---|---|---|
| quelques secondes | le client CMS rejoue ses **lectures**, 3 reprises sur ~12 s | `scripts/lib/directus.mjs` |
| quelques minutes à deux heures | le workflow **Rejeu** relance la publication à 8 h 15 puis 9 h 15 | `.github/workflows/rejeu.yml` |
| au-delà | la **Veille** de 10 h nomme l'absence et envoie le mail | `.github/workflows/veille.yml` |

Les **écritures** ne sont jamais rejouées à l'intérieur d'un run : une requête
peut avoir été reçue alors que sa réponse s'est perdue, et un `POST` rejoué
créerait un item en double. Elles se rattrapent à l'échelle du run, où c'est
sûr — le fichier reste dans `inbox/`, `saveBrief()` archive les items du passage
précédent au lieu d'en empiler.

`inbox/` non vide **est** l'état « quelque chose n'est pas passé » : l'archivage
n'a lieu qu'après le déploiement. Le Rejeu n'a donc aucun état à tenir ailleurs,
et il ne relance que si le CMS répond — sinon il ne fait que rejouer l'échec, et
son mail avec. Il sort en succès même quand il décide de ne rien faire : l'alarme
est le rôle de la Veille, et deux alarmes pour un incident en valent zéro.

Deux tentatives, pas une boucle. Un brief durablement recalé — une garde qui dit
non, ce qui n'est pas un accident — enverrait sinon un mail d'échec par heure.

## Les cinq gardes

Dans cet ordre, et l'ordre compte : la cohérence se juge sur ce qui reste une
fois les liens morts et les doublons retirés.

| | garde | ce qu'elle attrape | sanction |
|---|---|---|---|
| 1 | schéma | brief mal formé, champ inventé, URL non HTTPS | brief recalé |
| 2 | liens vivants | **URL inventée** — le mode de défaillance le plus probable | item retiré si l'adresse n'existe pas ; conservé sans date si l'accès est refusé |
| 3 | allowlist | source hors de `config/sources.json` | brief retenu en brouillon |
| 4 | doublons | histoire déjà couverte ces 14 derniers jours | item retiré |
| 5 | cohérence | date d'hier, résumé bavard, rangs en double | brief recalé |

Un **item** recalé est retiré, le brief part sans lui. Un **brief** recalé est
écrit en brouillon avec `ingest_status = failed` et sa raison, le job échoue
(GitHub envoie le mail) et le fichier reste dans `inbox/` pour rejeu.

La garde 2 distingue « la page n'existe pas » de « on ne me l'a pas montrée ». Un
404 retire l'item ; un 403 — mur anti-robot, mur payant — le conserve, sans
`link_checked_at`, parce qu'un refus d'accès ne prouve pas une adresse inventée.
Conclure l'un pour l'autre appauvrissait le brief en silence, et le journal
imputait alors à la source ce qui venait de la garde.

La garde 3 ne jette rien : jeter l'item ferait disparaître la source sans que
personne ne l'apprenne, et la liste ne s'enrichirait jamais.

## Pop-ups et événements

Le brief peut porter un tableau `events` facultatif : boutiques éphémères,
concerts, expositions, salons — pour quatre thèmes seulement, anime et manga,
Pokémon, K-pop, jeu vidéo. **Ce n'est pas une cinquième rubrique.** Une rubrique
vit dans le brief du jour ; un événement dure jusqu'à sa date de fin, quel que
soit le brief qui l'a repéré. Il a donc sa collection (`mat_events`), sa page
(`/evenements/`) et ses propres contrôles.

| ce qui cloche | sanction |
|---|---|
| dates irréelles, fin avant début, déjà terminé, résumé de plus de 40 mots | événement écarté |
| domaine hors allowlist | événement écarté — **pas** de brief retenu en brouillon |
| déjà connu (nom proche d'un événement actif) | événement écarté |
| source morte | événement écarté ; un accès refusé le garde, sans date |
| billetterie ou fiche Naver Map morte | le **champ** saute, l'événement reste |
| collection absente du CMS | avertissement au run, le brief paraît |

Un accessoire, comme la météo : rien de tout cela ne recale jamais un brief.
Seule une faute de schéma le fait, parce que le schéma juge le fichier entier.
Les écartés sont dits au résumé du run, et le contrôle avant vol les annonce à
l'agent en avertissement, jamais en faute.

**La page liste tout l'ensemble actif**, pas le seul apport du jour : l'agent
ajoute, la collection tient la liste. Il lit d'abord `/api/evenements.json`
pour ne pas reproposer ce qui s'y trouve. À chaque run, ce qui est fini passe à
l'archive — la chaîne n'efface jamais. Le site filtre en plus sur la date de fin
au build, et masque chez le lecteur ce qui a fini depuis, en quelques lignes qui
reprennent l'avis de parution.

**Un flux RSS par événement** (`/evenements.xml`), à l'inverse du flux des
briefs qui compte un élément par parution : on le suit pour être prévenu de
chaque nouveau pop-up. Stable d'un build à l'autre — identifiant et date de
création de l'événement — pour qu'un lecteur ne renotifie pas.

**L'épingle Naver Map** est un lien de recherche construit du lieu et du
quartier. Le dépôt interdit de reconstruire une URL, et celle-ci en est une : la
différence est ce qu'elle affirme. Une source reconstruite publie un fait qu'on
n'a pas vu ; un lien de recherche pose à Naver la question que le lecteur aurait
tapée. Quand l'agent a *vu* la fiche du lieu, il la donne dans `map_url`, et
elle remplace la recherche — sondée comme un lien, mais la sonde est partielle :
`map.naver.com` est une application qui répond 200 à n'importe quelle fiche,
seuls les liens courts `naver.me` répondent 404. D'où le repli.

## Ce qui ne doit jamais réussir en silence

- **Un build privé de ses sources doit échouer.** Ce site n'a aucun contenu
  local sur lequel retomber, et c'est délibéré. Quand le build échoue, le
  déploiement précédent reste en ligne : le lecteur voit le brief d'hier, ce qui
  est vrai, plutôt qu'une page vide ou éternellement fraîche.
- **« Pas de brief aujourd'hui » n'est pas une panne.** La page rend, datée. Le
  bandeau dit que celui du jour n'est pas encore paru.
- **La mention IA est portée par le brief**, pas par le pied de page : un brief
  lu depuis l'archive ou repris dans un flux RSS doit la porter aussi.
- **Une rubrique vide dit pourquoi elle l'est.** La phrase que l'agent a écrite
  ce matin-là, et non une formule générale — et quand ce sont les gardes qui ont
  vidé la rubrique, elle le dit, parce qu'« il n'y avait rien » et « rien n'a pu
  être vérifié » ne sont pas la même information.
- **Jamais le texte intégral d'une source**, ni sa traduction. Résumés courts en
  propre et lien : c'est la différence entre une revue de presse et une
  contrefaçon.

## Développer

```bash
npm install
npm test                 # les gardes, sur des briefs volontairement cassés
npm run dev              # demande DIRECTUS_URL et un jeton de lecture
npm run ingest           # ingère inbox/, demande le jeton d'écriture
```

Les tests tournent deux fois en CI, dans le fuseau de Séoul et en UTC : un brief
daté à Séoul et un runner en UTC sont à quinze heures l'un de l'autre.

## Deux jetons Directus, à ne pas confondre

- **écriture** (policy `mat — écriture`) : l'ingestion. Crée et met à jour, sans
  filtre de statut, sans droit de suppression.
- **lecture build** (policy `mat — lecture build`) : le build. Lecture seule du
  contenu publié.

Jamais le jeton d'administration, qui appartient à `platform-cms` : un build
local qui le porterait verrait des brouillons que la CI ne voit pas, réussirait
là où le déploiement échoue, et cesserait de prouver quoi que ce soit.

## Avant la première publication

1. Créer les deux utilisateurs applicatifs dans Directus et leurs jetons
   statiques (un jeton ne s'affiche qu'une fois).
2. Déposer les secrets du dépôt : `DIRECTUS_URL`, `DIRECTUS_INGEST_TOKEN`,
   `DIRECTUS_BUILD_TOKEN`, `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, et la
   variable `SITE_URL`.
3. Déposer à la racine du compte FTP un fichier vide **nommé d'après ce site**
   (`.deploy-cible-matinale`), et mettre ce nom dans la variable `DEPLOY_MARKER`.
   Sans lui, le workflow s'arrête avant la moindre écriture — c'est le seul
   rempart contre un `mirror --delete` sur le mauvais compte, et le FTP n'a pas
   de corbeille.

   > Le nom compte. Un marqueur générique, identique sur tous les sites, ne
   > vérifie plus que l'existence d'un serveur FTP quelque part : il laisse
   > passer le cas le plus probable, celui où l'on recopie les secrets FTP d'un
   > site voisin sans les changer.
4. Lancer le workflow à la main avec `dry_run`, puis lire la liste.

Le premier build ne peut réussir qu'après la première ingestion : sans brief
publié, il n'y a rien à mettre en ligne, et le site refuse de se construire
plutôt que de publier un site vide.
