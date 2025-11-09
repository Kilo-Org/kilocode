# Kilo Code CLI - Guide Docker

Une version conteneurisée du Kilo Code CLI avec support complet d'automatisation de navigateur.

## Exemples de Démarrage Rapide

### Construire l'Image

**Construction de base** (aucune métadonnée requise) :

```bash
cd cli
docker build -t kilocode/cli .
```

**Avec métadonnées de construction** (optionnel, pour production/CI) :

```bash
docker build \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  --build-arg VERSION=$(jq -r '.version' package.json) \
  -t kilocode/cli:$(jq -r '.version' package.json) \
  -t kilocode/cli:latest \
  .
```

Les arguments de construction sont tous optionnels et ont des valeurs par défaut :

- `BUILD_DATE` - par défaut chaîne vide
- `VCS_REF` - par défaut chaîne vide
- `VERSION` - par défaut "latest"

### 1. Mode Interactif de Base

Exécuter le CLI de manière interactive dans votre répertoire actuel :

```bash
docker run -it --rm -v $(pwd):/workspace kilocode/cli
```

### 2. Mode Architect

Démarrer en mode architect pour la planification et la conception :

```bash
docker run -it --rm -v $(pwd):/workspace kilocode/cli --mode architect
```

### 3. Mode Autonome One-Shot

Exécuter une seule tâche et quitter automatiquement :

```bash
docker run --rm -v $(pwd):/workspace kilocode/cli --auto "Exécuter les tests et corriger les problèmes"
```

### 4. Avec Configuration Locale

Monter votre configuration Kilo Code existante pour éviter les invites de configuration :

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  kilocode/cli
```

---

## Options Supplémentaires

### Chemin d'Espace de Travail Personnalisé

```bash
docker run -it --rm -v /path/to/project:/workspace kilocode/cli
```

### Monter la Configuration Git

Pour les opérations de commit :

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  -v ~/.gitconfig:/home/kilocode/.gitconfig:ro \
  kilocode/cli
```

### Variables d'Environnement

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e KILOCODE_MODE=code \
  kilocode/cli
```

### Avec Timeout

```bash
docker run --rm \
  -v $(pwd):/workspace \
  kilocode/cli /usr/local/bin/kilocode --timeout 300 --auto "Exécuter les tests"
```

## Configuration

### Configuration Persistante

Le CLI stocke la configuration dans `~/.kilocode/config.json`. Vous pouvez :

**Option 1 : Monter la configuration locale** (recommandé)

```bash
-v ~/.kilocode:/home/kilocode/.kilocode
```

**Option 2 : Utiliser un volume Docker pour une configuration isolée**

```bash
docker volume create kilocode-config
docker run -it --rm \
  -v $(pwd):/workspace \
  -v kilocode-config:/home/kilocode/.kilocode \
  kilocode/cli
```

### Couleurs et Thème du Terminal

Si vous rencontrez des problèmes de visibilité du texte (texte se confondant avec l'arrière-plan), vous pouvez :

**Option 1 : Définir explicitement le thème dans la configuration**

Éditer `~/.kilocode/config.json` :

```json
{
	"theme": "dark" // ou "light" pour les terminaux clairs
}
```

**Option 2 : Forcer les variables d'environnement de couleur**

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e FORCE_COLOR=1 \
  -e COLORTERM=truecolor \
  kilocode/cli
```

**Option 3 : Passer les informations du terminal**

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e TERM=$TERM \
  kilocode/cli
```
