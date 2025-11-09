# Kilo Code CLI

Orchestrez des agents depuis votre terminal. Planifiez, débuggez et codez rapidement avec une navigation prioritaire au clavier en ligne de commande.

La CLI Kilo Code utilise la même technologie sous-jacente qui alimente les extensions IDE, vous pouvez donc vous attendre au même flux de travail pour gérer les tâches de codage agentiel du début à la fin.

## Installation

`npm install -g @kilocode/cli`

Changez de répertoire vers l'endroit où vous souhaitez travailler et exécutez kilocode :

```
# Démarrer une session de chat interactive
kilocode

# Démarrer avec un mode spécifique
kilocode --mode architect

# Démarrer avec un espace de travail spécifique
kilocode --workspace /path/to/project
```

pour démarrer la CLI et commencer une nouvelle tâche avec votre modèle préféré et le mode approprié.

## Ce que vous pouvez faire avec Kilo Code CLI

- **Planifiez et exécutez des modifications de code sans quitter votre terminal.** Utilisez votre ligne de commande pour apporter des modifications à votre projet sans ouvrir votre IDE.
- **Basculez entre des centaines de LLM sans contraintes.** D'autres outils CLI ne fonctionnent qu'avec un seul modèle ou proposent des listes opiniâtres. Avec Kilo, vous pouvez changer de modèle sans démarrer un autre outil.
- **Choisissez le bon mode pour la tâche dans votre flux de travail.** Sélectionnez entre Architect, Ask, Debug, Orchestrator, ou des modes d'agent personnalisés.
- **Automatisez les tâches.** Obtenez une assistance IA pour écrire des scripts shell pour des tâches comme renommer tous les fichiers d'un dossier ou transformer les tailles d'un ensemble d'images.

## Référence CLI

### Commandes CLI

| Commande        | Description                                                          | Exemple                     |
| --------------- | -------------------------------------------------------------------- | --------------------------- |
| `kilocode`      | Démarrer en mode interactif                                          |                             |
| `/mode`         | Basculer entre les modes (architect, code, debug, ask, orchestrator) | `/mode orchestrator`        |
| `/model`        | Découvrir les modèles disponibles et basculer entre eux              |                             |
| `/model list`   | Lister les modèles disponibles                                       |                             |
| `/model info`   | Affiche la description d'un modèle spécifique par nom                | `/model info z-ai/glm-4.5v` |
| `/model select` | Sélectionner et basculer vers un nouveau modèle                      |                             |
| `/teams`        | Lister toutes les organisations auxquelles vous pouvez accéder       |                             |
| `/teams select` | Basculer vers une autre organisation                                 |                             |
| `/config`       | Ouvrir l'éditeur de configuration (identique à `kilocode config`)    |                             |
| `/new`          | Démarrer une nouvelle tâche avec l'agent avec une page blanche       |                             |
| `/help`         | Lister les commandes disponibles et comment les utiliser             |                             |
| `/exit`         | Quitter la CLI                                                       |                             |

## Référence de configuration pour les fournisseurs

Kilo vous donne la possibilité d'apporter vos propres clés pour un certain nombre de fournisseurs de modèles et de passerelles IA, comme OpenRouter et Vercel AI Gateway. Chaque fournisseur a des options de configuration uniques et certains vous permettent de définir des variables d'environnement.

Vous pouvez consulter le [Guide de Configuration des Fournisseurs](https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md) pour des exemples si vous souhaitez éditer les fichiers .config manuellement. Vous pouvez également exécuter :

`kilocode config`

pour compléter la configuration avec un flux de travail interactif en ligne de commande.

:::tip
Vous pouvez également utiliser la commande slash `/config` pendant une session interactive, ce qui équivaut à exécuter `kilocode config`.
:::

## Mode parallèle

Le mode parallèle permet à plusieurs instances Kilo Code de travailler en parallèle sur le même répertoire, sans conflits. Vous pouvez lancer autant d'instances Kilo Code que nécessaire ! Une fois terminées, les modifications seront disponibles sur une branche git séparée.

```bash
# Prérequis : doit être dans un dépôt git valide

# En mode interactif, les modifications seront validées au /exit
# Terminal 1
kilocode --parallel "improve xyz"
# Terminal 2
kilocode --parallel "improve abc"

# Fonctionne très bien avec le mode auto 🚀
# Terminal 1
kilocode --parallel --auto "improve xyz"
# Terminal 2
kilocode --parallel --auto "improve abc"
```

## Mode autonome (Non-Interactif)

Le mode autonome permet à Kilo Code de s'exécuter dans des environnements automatisés comme les pipelines CI/CD sans nécessiter d'interaction utilisateur.

```bash
# Exécuter en mode autonome avec une invite
kilocode --auto "Implement feature X"

# Exécuter en mode autonome avec une entrée redirigée
echo "Fix the bug in app.ts" | kilocode --auto

# Exécuter en mode autonome avec délai d'attente (en secondes)
kilocode --auto "Run tests" --timeout 300
```

### Comportement du mode autonome

Lors de l'exécution en mode autonome (flag `--auto`) :

1. **Aucune interaction utilisateur** : Toutes les demandes d'approbation sont gérées automatiquement en fonction de la configuration
2. **Auto-approbation/rejet** : Les opérations sont approuvées ou rejetées en fonction de vos paramètres d'auto-approbation
3. **Questions de suivi** : Répondues automatiquement avec un message instruisant l'IA à prendre des décisions autonomes
4. **Sortie automatique** : La CLI se ferme automatiquement lorsque la tâche est terminée ou expire

### Configuration d'auto-approbation

Le mode autonome respecte votre configuration d'auto-approbation. Éditez votre fichier de configuration avec `kilocode config` pour personnaliser :

```json
{
	"autoApproval": {
		"enabled": true,
		"read": {
			"enabled": true,
			"outside": true
		},
		"write": {
			"enabled": true,
			"outside": false,
			"protected": false
		},
		"execute": {
			"enabled": true,
			"allowed": ["npm", "git", "pnpm"],
			"denied": ["rm -rf", "sudo"]
		},
		"browser": {
			"enabled": false
		},
		"mcp": {
			"enabled": true
		},
		"mode": {
			"enabled": true
		},
		"subtasks": {
			"enabled": true
		},
		"question": {
			"enabled": false,
			"timeout": 60
		},
		"retry": {
			"enabled": true,
			"delay": 10
		},
		"todo": {
			"enabled": true
		}
	}
}
```

**Options de configuration :**

- `read`: Auto-approuver les opérations de lecture de fichiers
    - `outside`: Autoriser la lecture de fichiers en dehors de l'espace de travail
- `write`: Auto-approuver les opérations d'écriture de fichiers
    - `outside`: Autoriser l'écriture de fichiers en dehors de l'espace de travail
    - `protected`: Autoriser l'écriture dans des fichiers protégés (ex: package.json)
- `execute`: Auto-approuver l'exécution de commandes
    - `allowed`: Liste des motifs de commandes autorisées (ex: ["npm", "git"])
    - `denied`: Liste des motifs de commandes refusées (prioritaire)
- `browser`: Auto-approuver les opérations de navigateur
- `mcp`: Auto-approuver l'utilisation des outils MCP
- `mode`: Auto-approuver le changement de mode
- `subtasks`: Auto-approuver la création de sous-tâches
- `question`: Auto-approuver les questions de suivi
- `retry`: Auto-approuver les demandes de nouvelle tentative API
- `todo`: Auto-approuver les mises à jour de liste de tâches

### Motifs d'approbation de commandes

Les listes `execute.allowed` et `execute.denied` supportent la correspondance de motifs hiérarchiques :

- **Commande de base** : `"git"` correspond à n'importe quelle commande git (ex: `git status`, `git commit`, `git push`)
- **Commande + sous-commande** : `"git status"` correspond à n'importe quelle commande git status (ex: `git status --short`, `git status -v`)
- **Commande complète** : `"git status --short"` ne correspond qu'à exactement `git status --short`

**Exemple :**

```json
{
	"execute": {
		"enabled": true,
		"allowed": [
			"npm", // Autorise toutes les commandes npm
			"git status", // Autorise toutes les commandes git status
			"ls -la" // Autorise uniquement "ls -la"
		],
		"denied": [
			"git push --force" // Refuse cette commande spécifique même si "git" est autorisé
		]
	}
}
```

### Approbation de commandes interactive

Lors de l'exécution en mode interactif, les demandes d'approbation de commandes affichent désormais des options hiérarchiques :

```
[!] Action requise :
> ✓ Exécuter la commande (y)
  ✓ Toujours exécuter git (1)
  ✓ Toujours exécuter git status (2)
  ✓ Toujours exécuter git status --short --branch (3)
  ✗ Rejeter (n)
```

Sélectionner une option "Toujours exécuter" va :

1. Approuver et exécuter la commande actuelle
2. Ajouter le motif à votre liste `execute.allowed` dans la configuration
3. Auto-approuver les commandes correspondantes à l'avenir

Cela vous permet de construire progressivement vos règles d'auto-approbation sans éditer manuellement le fichier de configuration.

### Questions de suivi en mode autonome

En mode autonome, lorsque l'IA pose une question de suivi, elle reçoit cette réponse :

> "Ce processus s'exécute en mode autonome non-interactif. L'utilisateur ne peut pas prendre de décisions, vous devez donc prendre la décision de manière autonome."

Cela instruit l'IA à procéder sans entrée utilisateur.

### Codes de sortie

- `0`: Succès (tâche terminée)
- `124`: Délai d'attente dépassé (tâche ayant dépassé la limite de temps)
- `1`: Erreur (échec d'initialisation ou d'exécution)

### Exemple d'intégration CI/CD

```yaml
# Exemple GitHub Actions
- name: Exécuter Kilo Code
  run: |
      echo "Implement the new feature" | kilocode --auto --timeout 600
```

## Substitutions de variables d'environnement

La CLI supporte la substitution des valeurs de configuration par des variables d'environnement. Les variables d'environnement supportées sont :

- `KILO_PROVIDER`: Substituer l'ID du fournisseur actif
- Pour le fournisseur `kilocode`: `KILOCODE_<FIELD_NAME>` (ex: `KILOCODE_MODEL` → `kilocodeModel`)
- Pour les autres fournisseurs: `KILO_<FIELD_NAME>` (ex: `KILO_API_KEY` → `apiKey`)

## Développement local

### DevTools

Pour exécuter la CLI avec les devtools, ajoutez `DEV=true` à votre commande `pnpm start`, puis exécutez `npx react-devtools` pour afficher l'inspecteur devtools.

## Basculement vers une organisation depuis la CLI

Utilisez la commande `/teams` pour voir la liste de toutes les organisations auxquelles vous pouvez accéder.

Utilisez `/teams select` et commencez à taper le nom de l'équipe pour changer d'équipe.

Le processus est le même lors du basculement vers une organisation Team ou Enterprise.
