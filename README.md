# La Matinale de Séoul

Brief d'actualité quotidien en français : tourisme en Corée, actualités
coréennes, tech et IA, jeu vidéo. Un brief par jour ouvré, quatre rubriques,
12 à 24 items.

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
| 2 | liens vivants | **URL inventée** — le mode de défaillance le plus probable | item retiré |
| 3 | allowlist | source hors de `config/sources.json` | brief retenu en brouillon |
| 4 | doublons | histoire déjà couverte ces 14 derniers jours | item retiré |
| 5 | cohérence | date d'hier, résumé bavard, rangs en double | brief recalé |

Un **item** recalé est retiré, le brief part sans lui. Un **brief** recalé est
écrit en brouillon avec `ingest_status = failed` et sa raison, le job échoue
(GitHub envoie le mail) et le fichier reste dans `inbox/` pour rejeu.

La garde 3 ne jette rien : jeter l'item ferait disparaître la source sans que
personne ne l'apprenne, et la liste ne s'enrichirait jamais.

## Ce qui ne doit jamais réussir en silence

- **Un build privé de ses sources doit échouer.** Ce site n'a aucun contenu
  local sur lequel retomber, et c'est délibéré. Quand le build échoue, le
  déploiement précédent reste en ligne : le lecteur voit le brief d'hier, ce qui
  est vrai, plutôt qu'une page vide ou éternellement fraîche.
- **« Pas de brief aujourd'hui » n'est pas une panne.** La page rend, datée. Le
  bandeau dit que celui du jour n'est pas encore paru.
- **La mention IA est portée par le brief**, pas par le pied de page : un brief
  lu depuis l'archive ou repris dans un flux RSS doit la porter aussi.
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
