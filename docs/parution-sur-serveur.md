# Installer la parution sur un serveur

À faire une fois, sur une machine allumée en permanence. Ce que produit cette
installation : chaque jour ouvré à 8 h heure de Séoul, un brief est rédigé,
vérifié et poussé dans `inbox/` — la suite appartient à GitHub Actions.

## Pourquoi un serveur, et pas le cloud

Trois environnements ont été essayés le 7 septembre 2026. Aucun des deux
premiers ne convient, et c'est une affaire de capacités, pas de réglages :

| | lit le web | pousse dans le dépôt |
|---|---|---|
| Tâche planifiée claude.ai | oui | **non** — aucun connecteur GitHub sur ce compte |
| Routine Claude Code cloud | **non** — egress fermé, y compris `example.com` | oui |
| Claude Code sur un serveur | oui | oui |

Le travail exige les deux : lire de vraies pages pour en citer de vraies
adresses, puis déposer le fichier. Seul le troisième les réunit.

## Prérequis

- **Node ≥ 22** et **git**
- **Claude Code**, authentifié pour le compte qui paiera les sessions
- Un accès en écriture au dépôt, sous une des deux formes :
  - `gh auth login` avec un compte ayant le droit de pousser ;
  - ou un **PAT fine-grained**, `Contents: write` sur ce seul dépôt, **sans la
    permission `Workflows`** — l'agent dépose du contenu, il n'a rien à faire
    dans `.github/`.

## Installation

```bash
git clone https://github.com/Fbrend23/matinale-seoul.git
cd matinale-seoul
npm ci
chmod +x bin/brief-du-jour.sh

# Un essai à blanc, en regardant : la session tourne, le journal se remplit.
bin/brief-du-jour.sh ; echo "code de sortie : $?"
cat logs/brief-$(date -u +%Y-%m).log
```

Le script part de `origin/main` par un `reset --hard` : ce qui traîne dans la
copie locale est écrasé. C'est voulu — le dépôt du serveur est un poste de
travail automatique, pas un endroit où l'on garde des modifications.

## Programmer la parution

8 h à Séoul, c'est 23 h UTC la veille — d'où le décalage des jours dans le cron
(dimanche à jeudi couvre lundi à vendredi, heure de Séoul).

```cron
0 23 * * 0-4  cd /chemin/vers/matinale-seoul && bin/brief-du-jour.sh
```

Si le cron de la machine tourne à l'heure locale plutôt qu'en UTC, préférer une
ligne explicite plutôt qu'un calcul de tête :

```cron
CRON_TZ=Asia/Seoul
0 8 * * 1-5  cd /chemin/vers/matinale-seoul && bin/brief-du-jour.sh
```

Sous Windows, la tâche planifiée appelle le script via Git Bash :

```
"C:\Program Files\Git\bin\bash.exe" -lc "cd /e/chemin/matinale-seoul && bin/brief-du-jour.sh"
```

## Savoir ce qui s'est passé

Le script écrit dans `logs/brief-AAAA-MM.log`, un fichier par mois, non
versionné. Il sort en **code 1** dès que le brief n'a pas été poussé — ce qui
permet à un cron surveillé, ou à un `systemd` avec `OnFailure`, de prévenir.

Deux issues sans panne, à ne pas confondre avec un incident :

- **l'agent n'a rien poussé volontairement**, faute de sources vérifiables. La
  règle qu'on lui a donnée est de se taire plutôt que d'inventer une adresse ;
- **le contrôle avant vol a recalé son brouillon** et il n'a pas su corriger.

Dans les deux cas le journal le dit, et le site continue d'afficher le dernier
brief publié, daté.

Côté GitHub, `Veille` reprend le relais : elle constate à 11 h heure de Séoul
qu'aucun brief du jour n'est publié et le signale par courriel. Elle est en
pause tant que la parution n'est pas en service — la rallumer :

```bash
gh workflow enable veille.yml --repo Fbrend23/matinale-seoul
```

## Ce que le serveur ne doit pas devenir

- **Pas de secret du CMS ici.** Le serveur pousse un fichier, rien de plus.
  `DIRECTUS_INGEST_TOKEN` et `DIRECTUS_BUILD_TOKEN` vivent dans les secrets
  GitHub, où la CI les lit. Un serveur compromis ne doit pas donner le CMS.
- **Pas de modification du dépôt à la main.** Le `reset --hard` l'effacerait au
  passage suivant, et une correction qui disparaît toute seule est pire qu'une
  correction absente. Tout changement se fait par commit, depuis un poste de
  travail.
