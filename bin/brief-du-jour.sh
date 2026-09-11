#!/usr/bin/env bash
# Produit et dépose le brief du jour. Conçu pour tourner sans personne devant,
# depuis le cron d'un serveur allumé en permanence.
#
#   bin/brief-du-jour.sh
#
# POURQUOI UN SCRIPT ET PAS UNE LIGNE DE CRON. Une ligne de cron ne sait pas
# dire ce qu'elle a fait. Celui-ci journalise, échoue bruyamment, et se relit :
# le matin où le brief manque, c'est ici qu'on regarde.
#
# CE QU'IL SUPPOSE, et que l'installation doit fournir (voir
# docs/parution-sur-serveur.md) : Node ≥ 22, git, Claude Code authentifié, et un
# remote « origin » qui accepte le push.

set -euo pipefail

DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPOT"

mkdir -p logs
# Daté à SÉOUL, comme le brief lui-même et comme la commande que la
# documentation donne pour le relire. En UTC, le journal du 1er de chaque mois
# partait dans le fichier du mois PRÉCÉDENT — 7 h 30 à Séoul valant 22 h 30 UTC
# la veille — et « tail logs/brief-$(TZ=Asia/Seoul date +%Y-%m).log » ouvrait un
# fichier vide. Le matin précis où l'on cherche pourquoi le brief manque.
JOURNAL="logs/brief-$(TZ=Asia/Seoul date +%Y-%m).log"

# Depuis un terminal, on veut voir CE QUI SE PASSE autant que le journaliser :
# un script qui n'affiche rien à l'essai laisse croire qu'il n'a rien fait.
# Depuis le cron, personne ne regarde : tout va au journal, et lui seul.
if [ -t 1 ]; then
  echo "(journal : $DEPOT/$JOURNAL)"
  exec > >(tee -a "$JOURNAL") 2>&1
else
  exec >> "$JOURNAL" 2>&1
fi

# Le jour tel qu'il est à Séoul, jamais celui du serveur : c'est de là que le
# brief parle, et c'est ce que la garde de cohérence vérifiera.
JOUR=$(TZ=Asia/Seoul date +%F)
ATTENDU="inbox/brief-${JOUR}.json"

echo ""
echo "════════════════════════════════════════════════════════"
echo "$(date -u +%FT%TZ) UTC — brief du $JOUR (heure de Séoul)"

echec() {
  echo "ÉCHEC : $1"
  echo "Le brief du $JOUR n'a pas été déposé."
  exit 1
}

# Partir de l'état publié : le prompt et le schéma peuvent avoir changé depuis
# hier, et c'est la version du dépôt qui fait foi.
git fetch --quiet origin main || echec "git fetch impossible"
git checkout --quiet main
git reset --hard --quiet origin/main
# npm ci SEULEMENT si les dépendances ont bougé. Le temps gagné est négligeable
# et il faut le dire : npm ci prend 4 secondes ici, sur un run de douze minutes.
# CE QUI EST GAGNÉ EST AILLEURS — une réinstallation quotidienne met le registre
# npm sur le chemin critique de la parution. Son incident devient alors un matin
# sans brief, alors que node_modules était déjà bon. On retire une dépendance
# réseau dont on n'avait pas besoin, pas quatre secondes.
#
# L'empreinte vit DANS node_modules : effacer l'un efface l'autre, et le doute
# ne peut pas survivre à ce qu'il décrit.
EMPREINTE="node_modules/.empreinte-lock"
ATTENDUE=$(sha256sum package-lock.json | cut -d" " -f1)
if [ "$(cat "$EMPREINTE" 2>/dev/null)" = "$ATTENDUE" ]; then
  echo "dépendances inchangées, npm ci sauté"
else
  echo "package-lock.json a bougé (ou node_modules est absent) : npm ci"
  npm ci --silent || echec "npm ci"
  echo "$ATTENDUE" > "$EMPREINTE"
fi

# La consigne est versionnée à côté : la modifier est un commit, relu, et non un
# réglage de cron que personne ne relit jamais.
CONSIGNE=$(cat prompts/consigne-serveur.txt)

# Le modèle est FIXÉ ET JOURNALISÉ. Sans --model, la session prend le défaut de
# la machine : le brief d'hier et celui de demain pourraient être écrits par deux
# modèles différents sans que rien ne le dise, et une baisse de qualité
# deviendrait impossible à rattacher à sa cause.
#
# D'où l'identifiant COMPLET, et non l'alias « sonnet ». L'alias suit la
# génération courante : le jour où Sonnet 6 sortira, il changera de modèle tout
# seul, sans commit, sans ligne de journal — exactement ce que le paragraphe
# ci-dessus dit vouloir empêcher. Le relever se fait ici, par un commit.
#   MATINALE_MODELE=claude-opus-5 bin/brief-du-jour.sh   pour en essayer un autre
MODELE="${MATINALE_MODELE:-claude-sonnet-5}"
echo "modèle : $MODELE"

# --allowedTools plutôt que --dangerously-skip-permissions : la liste dit
# exactement ce que l'agent peut faire. Un outil hors liste fait échouer la
# session au lieu de l'autoriser en silence — et « échouer » est ici le bon
# comportement, puisque personne ne regarde.
#
# timeout : sans lui, une session qui s'enlise tiendrait la place jusqu'au
# lendemain, et le cron suivant trouverait un dépôt à moitié modifié.
timeout 25m claude -p "$CONSIGNE" \
  --model "$MODELE" \
  --permission-mode acceptEdits \
  --allowedTools "Bash(git *)" "Bash(npm *)" "Bash(node *)" Read Write Edit Glob Grep WebSearch WebFetch \
  || echec "la session Claude Code s'est terminée en erreur (ou a dépassé 25 minutes)"

# La seule preuve qui vaille : le fichier est-il sur origin ?
# Un agent peut très bien avoir « terminé » sans rien pousser — c'est même ce
# qu'on lui demande quand ses sources ne tiennent pas.
git fetch --quiet origin main
if git ls-tree --name-only origin/main inbox/ | grep -qx "$ATTENDU"; then
  echo "OK : $ATTENDU poussé ($(git rev-parse --short origin/main))"
  echo "La suite appartient à GitHub Actions : gardes, CMS, build, déploiement."
else
  echo "Rien n'a été poussé. Ce n'est pas forcément une panne :"
  echo "  · l'agent refuse de publier un brief dont il n'a pu vérifier les sources ;"
  echo "  · le contrôle avant vol a recalé son brouillon."
  echo "La raison exacte est plus haut dans ce journal."
  exit 1
fi
