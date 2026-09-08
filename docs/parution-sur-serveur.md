# Installer la parution sur un serveur

À faire une fois, sur une machine allumée en permanence. Ce que produit cette
installation : chaque jour ouvré, le brief est rédigé, vérifié et poussé dans
`inbox/` pour être en ligne à 8 h, heure de Séoul — la suite appartient à GitHub Actions.

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
- **Un git qui sait s'authentifier tout seul.** C'est le prérequis qu'on oublie :
  la session rédige, valide, commite — puis échoue sur
  `could not read Username for 'https://github.com'`, parce qu'il n'y a personne
  pour taper un mot de passe. Le travail est fait, il ne part pas.

  **Une clé de déploiement SSH**, c'est la forme retenue : elle est propre à ce
  dépôt, se révoque seule, et ne met aucun compte GitHub sur le serveur.

  ```bash
  # Sans passphrase : le cron n'a personne pour la taper.
  ssh-keygen -t ed25519 -C "matinale-seoul serveur" -f ~/.ssh/matinale -N ""

  # Sans cette ligne, ssh demanderait de confirmer l'empreinte de github.com au
  # premier passage, et attendrait une réponse que le cron ne donnera jamais.
  ssh-keyscan github.com >> ~/.ssh/known_hosts

  # Cette clé pour ce dépôt seulement. CHEMIN ABSOLU : git ne développe pas
  # toujours le tilde, et ssh prendrait alors le reste pour un nom d'hôte.
  git config core.sshCommand 'ssh -i /home/UTILISATEUR/.ssh/matinale -o IdentitiesOnly=yes'
  git remote set-url origin 'git@github.com:Fbrend23/matinale-seoul.git'

  cat ~/.ssh/matinale.pub   # à déposer dans Settings > Deploy keys, « Allow write access »
  ```

  À vérifier **avant** le premier passage :

  ```bash
  ssh -i ~/.ssh/matinale -T git@github.com
  # « Hi Fbrend23/matinale-seoul! You've successfully authenticated,
  #   but GitHub does not provide shell access. » — c'est la bonne réponse.
  git push --dry-run origin main
  ```

  > Une espace de trop dans `core.sshCommand` (`- o` au lieu de `-o`) donne
  > `hostname contains invalid characters` : ssh prend alors l'option orpheline
  > pour un nom d'hôte. Relire la valeur avec
  > `git config --get core.sshCommand | cat -A` avant de chercher ailleurs.

  **`gh` n'a rien à faire sur ce serveur.** Il sert à administrer le dépôt —
  activer un workflow, poser un secret — ce qui se fait depuis un poste de
  travail. Le serveur, lui, ne fait que pousser un fichier.

  Ne jamais accorder la permission `Workflows` à quoi que ce soit ici : l'agent
  dépose du contenu, il n'a rien à faire dans `.github/`.

## Installation

```bash
git clone https://github.com/Fbrend23/matinale-seoul.git
cd matinale-seoul
npm ci
chmod +x bin/brief-du-jour.sh

# Un essai, en regardant. Lancé depuis un terminal, le script affiche ce qu'il
# fait ET le journalise ; depuis le cron, il ne fait que journaliser.
bin/brief-du-jour.sh ; echo "code de sortie : $?"
```

Si rien ne s'affiche, c'est que la sortie n'a pas été reconnue comme un
terminal — tout est alors dans le journal :

```bash
cat logs/brief-$(date -u +%Y-%m).log
```

Le script part de `origin/main` par un `reset --hard` : ce qui traîne dans la
copie locale est écrasé. C'est voulu — le dépôt du serveur est un poste de
travail automatique, pas un endroit où l'on garde des modifications.

> **Ne jamais faire `git pull` sur ce clone.** Une session interrompue peut y
> laisser un commit non poussé ; `git pull` s'arrête alors sur des « divergent
> branches » et réclame un arbitrage, ce que le cron ne sait pas rendre. Le
> script n'a pas ce problème puisqu'il se réaligne de force à chaque passage :
> il n'y a rien à mettre à jour avant de le lancer.
>
> Pour reprendre la main après une divergence, regarder d'abord ce que le
> serveur a en trop — ce peut être un brief rédigé mais jamais parti :
>
> ```bash
> git fetch origin && git log --oneline origin/main..HEAD
> ```
>
> puis `git push origin main` s'il vaut d'être publié, ou
> `git reset --hard origin/main` sinon.

## Programmer la parution

**Le brief paraît à 8 h, heure de Séoul.** C'est le fuseau dont il parle, et
celui où son lecteur le lira. Le cron part donc à 7 h là-bas : la rédaction prend
une dizaine de minutes, la chaîne GitHub trois de plus.

Le serveur vit à l'heure de Berne, mais **on ne convertit pas de tête** :
`CRON_TZ` le fait, et surtout il survit aux changements d'heure — une heure de
Berne figée dériverait d'une heure deux fois l'an, précisément dans le fuseau où
l'on ne veut pas dériver.

```bash
(crontab -l 2>/dev/null; echo "PATH=$PATH"; echo 'CRON_TZ=Asia/Seoul'; \
 echo '0 7 * * 1-5 cd "/chemin/vers/matinale-seoul" && bin/brief-du-jour.sh') | crontab -
```

> `CRON_TZ`, comme `PATH`, ne vaut que pour les lignes qui le suivent : les
> tâches déjà présentes au-dessus gardent leur fuseau et leur environnement.

> **`PATH=$PATH` n'est pas décoratif.** Cron démarre avec un chemin minimal, où
> `claude` ne figure pas s'il vit dans `~/.local/bin` ou sous nvm. Sans cette
> ligne, le script échoue en 127 chaque matin, alors qu'il marche parfaitement
> lancé à la main — le genre de panne qu'on cherche du mauvais côté pendant une
> heure.
>
> **Guillemets autour du chemin**, jamais `\ ` pour l'espace de « Seoul News » :
> dans une crontab, l'échappement par backslash n'a pas le même sens.

**Rien dans le code ne dépend de l'horloge du serveur** : le jour du brief est
toujours calculé sur `Asia/Seoul`, aussi bien par les gardes que par le site. Le
`CRON_TZ` ne règle que l'heure du déclenchement ; déplacer le serveur d'un fuseau
à l'autre ne changerait pas d'un jour la date d'un seul brief.

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

Côté GitHub, `Veille` reprend le relais : à 10 h heure de Séoul, soit trois
heures après la parution, elle constate qu'aucun brief du jour n'est publié et le
signale par courriel. C'est le seul garde-fou qui parle de ce qui **n'a pas eu
lieu** ; tous les autres ne signalent que des échecs.

Si on la met un jour en pause, la rallumer depuis un poste de travail — pas
depuis le serveur, qui n'a pas à administrer le dépôt :

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
