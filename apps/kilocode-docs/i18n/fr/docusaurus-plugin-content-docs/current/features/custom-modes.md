# Modes Personnalisés

Kilo Code vous permet de créer des **modes personnalisés** pour adapter le comportement de Kilo à des tâches ou flux de travail spécifiques. Les modes personnalisés peuvent être soit **globaux** (disponibles à travers tous les projets) soit **spécifiques au projet** (définis dans un seul projet).

## Modèles Collants pour un Flux de Travail Efficace

Chaque mode—y compris les personnalisés—comporte des **Modèles Collants**. Cela signifie que Kilo Code se souvient automatiquement et sélectionne le dernier modèle que vous avez utilisé avec un mode particulier. Cela vous permet d'assigner différents modèles préférés à différentes tâches sans reconfiguration constante, car Kilo bascule entre les modèles quand vous changez de modes.

## Pourquoi Utiliser les Modes Personnalisés ?

- **Spécialisation :** Créez des modes optimisés pour des tâches spécifiques, comme "Rédacteur de Documentation," "Ingénieur de Tests," ou "Expert en Refactoring"
- **Sécurité :** Restreignez l'accès d'un mode aux fichiers sensibles ou commandes. Par exemple, un "Mode Révision" pourrait être limité aux opérations en lecture seule
- **Expérimentation :** Expérimentez en sécurité avec différents prompts et configurations sans affecter les autres modes
- **Collaboration d'Équipe :** Partagez les modes personnalisés avec votre équipe pour standardiser les flux de travail

<img src="/docs/img/custom-modes/custom-modes.png" alt="Aperçu de l'interface des modes personnalisés" width="600" />

_Interface de Kilo Code pour créer et gérer les modes personnalisés._

## Ce qui est Inclus dans un Mode Personnalisé ?

Les modes personnalisés sont définis par plusieurs propriétés clés. Comprendre ces concepts vous aidera à adapter efficacement le comportement de Kilo.

| Champ UI / Propriété YAML                              | Description Conceptuelle                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slug** (`slug`)                                      | Un identifiant interne unique pour le mode. Utilisé par Kilo Code pour référencer le mode, particulièrement pour associer les fichiers d'instructions spécifiques au mode.                                                   |
| **Nom** (`name`)                                       | Le nom d'affichage pour le mode tel qu'il apparaît dans l'interface utilisateur Kilo Code. Devrait être lisible par l'homme et descriptif.                                                                                   |
| **Description** (`description`)                        | Un résumé court, convivial pour l'utilisateur du but du mode affiché dans l'interface de sélection de mode. Gardez cela concis et focalisé sur ce que le mode fait pour l'utilisateur.                                       |
| **Définition de Rôle** (`roleDefinition`)              | Définit l'identité de base et l'expertise du mode. Ce texte est placé au début du prompt système et définit la personnalité et le comportement de Kilo quand ce mode est actif.                                              |
| **Outils Disponibles** (`groups`)                      | Définit les ensembles d'outils autorisés et les permissions d'accès aux fichiers pour le mode. Correspond à la sélection de quelles catégories générales d'outils le mode peut utiliser.                                     |
| **Quand Utiliser** (`whenToUse`)                       | _(Optionnel)_ Fournit des conseils pour la prise de décision automatisée de Kilo, particulièrement pour la sélection de mode et l'orchestration de tâches. Utilisé par le mode Orchestrateur pour la coordination de tâches. |
| **Instructions Personnalisées** (`customInstructions`) | _(Optionnel)_ Directives comportementales spécifiques ou règles pour le mode. Ajoutées près de la fin du prompt système pour affiner davantage le comportement de Kilo.                                                      |

## Importer/Exporter les Modes

Partagez, sauvegardez et template facilement vos modes personnalisés. Cette fonctionnalité vous permet d'exporter n'importe quel mode—et ses règles associées—dans un seul fichier YAML portable que vous pouvez importer dans n'importe quel projet.

### Fonctionnalités Clés

- **Configurations Partageables :** Empaquetez un mode et ses règles dans un fichier pour facilement partager avec votre équipe
- **Sauvegardes Faciles :** Sauvegardez vos configurations de modes personnalisés pour ne jamais les perdre
- **Templates de Projet :** Créez des templates de modes standardisés pour différents types de projets
- **Migration Simple :** Déplacez les modes entre vos paramètres globaux et projets spécifiques sans effort
- **Changements de Slug Flexibles :** Changez les slugs de mode dans les fichiers exportés sans édition manuelle de chemin

### Comment ça Fonctionne

**Exporter un Mode :**

1. Naviguez vers la vue Modes
2. Sélectionnez le mode que vous souhaitez exporter
3. Cliquez sur le bouton Exporter le Mode (icône de téléchargement)
4. Choisissez un emplacement pour sauvegarder le fichier `.yaml`
5. Kilo empaquette la configuration du mode et toutes les règles dans le fichier YAML

**Importer un Mode :**

1. Cliquez sur le bouton Importer le Mode (icône de téléchargement) dans la vue Modes
2. Sélectionnez le fichier YAML du mode
3. Choisissez le niveau d'import :
    - **Projet :** Disponible seulement dans l'espace de travail actuel (sauvegardé dans le fichier `.kilocodemodes`)
    - **Global :** Disponible dans tous les projets (sauvegardé dans les paramètres globaux)

### Changer les Slugs à l'Import

Quand vous importez des modes, vous pouvez changer le slug dans le fichier YAML exporté avant d'importer :

1. Exportez un mode avec le slug `mode-original`
2. Éditez le fichier YAML et changez le slug en `nouveau-mode`
3. Importez le fichier - le processus d'import mettra automatiquement à jour les chemins de fichiers de règles pour correspondre au nouveau slug

## Méthodes pour Créer et Configurer les Modes Personnalisés

Vous pouvez créer et configurer les modes personnalisés de plusieurs façons :

### 1. Demandez à Kilo ! (Recommandé)

Vous pouvez créer rapidement un mode personnalisé de base en demandant à Kilo Code de le faire pour vous. Par exemple :

```
Créez un nouveau mode appelé "Rédacteur de Documentation". Il devrait seulement pouvoir lire les fichiers et écrire des fichiers Markdown.
```

Kilo Code vous guidera à travers le processus, en vous demandant les informations nécessaires et en créant le mode en utilisant le format YAML préféré.

### 2. Utiliser l'Onglet Prompts

1. **Ouvrez l'Onglet Prompts :** Cliquez sur l'icône <Codicon name="notebook" /> dans la barre de menu supérieure de Kilo Code
2. **Créer un Nouveau Mode :** Cliquez sur le bouton <Codicon name="add" /> à droite de l'en-tête Modes
3. **Remplissez les Champs :**

<img src="/docs/img/custom-modes/custom-modes-2.png" alt="Interface de création de mode personnalisé dans l'onglet Prompts" width="600" />

_L'interface de création de mode personnalisé montrant les champs pour nom, slug, description, emplacement de sauvegarde, définition de rôle, outils disponibles, instructions personnalisées._

L'interface fournit des champs pour Nom, Slug, Description, Emplacement de Sauvegarde, Définition de Rôle, Quand Utiliser (optionnel), Outils Disponibles, et Instructions Personnalisées. Après avoir rempli ces champs, cliquez sur le bouton "Créer le Mode". Kilo Code sauvegardera le nouveau mode en format YAML.

### 3. Configuration Manuelle (YAML & JSON)

Vous pouvez éditer directement les fichiers de configuration pour créer ou modifier des modes personnalisés. Cette méthode offre le plus de contrôle sur toutes les propriétés. Kilo Code supporte maintenant à la fois les formats YAML (préféré) et JSON.

- **Modes Globaux :** Éditez le fichier `custom_modes.yaml` (préféré) ou `custom_modes.json`. Accédez-y via Onglet Prompts > <Codicon name="gear" /> (Icône Menu Paramètres à côté de "Prompts Globaux") > "Éditer les Modes Globaux"
- **Modes Projet :** Éditez le fichier `.kilocodemodes` (qui peut être YAML ou JSON) dans la racine de votre projet. Accédez-y via Onglet Prompts > <Codicon name="gear" /> (Icône Menu Paramètres à côté de "Prompts Projet") > "Éditer les Modes Projet"

Ces fichiers définissent un array/liste de modes personnalisés.

## Format de Configuration YAML (Préféré)

YAML est maintenant le format préféré pour définir les modes personnalisés en raison d'une meilleure lisibilité, support de commentaires, et chaînes multi-lignes plus propres.

### Exemple YAML

```yaml
customModes:
    - slug: redacteur-docs
      name: 📝 Rédacteur de Documentation
      description: Un mode spécialisé pour écrire et éditer de la documentation technique.
      roleDefinition: Vous êtes un rédacteur technique spécialisé en documentation claire.
      whenToUse: Utilisez ce mode pour écrire et éditer de la documentation.
      customInstructions: Focalisez-vous sur la clarté et l'exhaustivité dans la documentation.
      groups:
          - read
          - - edit # Premier élément du tuple
            - fileRegex: \.(md|mdx)$ # Deuxième élément est l'objet options
              description: Fichiers Markdown seulement
          - browser
    - slug: autre-mode
      name: Autre Mode
      # ... autres propriétés
```

### Alternative JSON

```json
{
	"customModes": [
		{
			"slug": "redacteur-docs",
			"name": "📝 Rédacteur de Documentation",
			"description": "Un mode spécialisé pour écrire et éditer de la documentation technique.",
			"roleDefinition": "Vous êtes un rédacteur technique spécialisé en documentation claire.",
			"whenToUse": "Utilisez ce mode pour écrire et éditer de la documentation.",
			"customInstructions": "Focalisez-vous sur la clarté et l'exhaustivité dans la documentation.",
			"groups": [
				"read",
				["edit", { "fileRegex": "\\.(md|mdx)$", "description": "Fichiers Markdown seulement" }],
				"browser"
			]
		}
	]
}
```

## Détails des Propriétés YAML/JSON

### `slug`

- **But :** Un identifiant unique pour le mode
- **Format :** Doit correspondre au motif `/^[a-zA-Z0-9-]+$/` (seulement lettres, chiffres, et tirets)
- **Usage :** Utilisé intérieurement et dans les noms de fichiers/répertoires pour les règles spécifiques au mode (ex. `.kilo/rules-{slug}/`)
- **Recommandation :** Gardez-le court et descriptif

**Exemple YAML :** `slug: redacteur-docs`
**Exemple JSON :** `"slug": "redacteur-docs"`

### `name`

- **But :** Le nom d'affichage montré dans l'UI Kilo Code
- **Format :** Peut inclure des espaces et une capitalisation appropriée

**Exemple YAML :** `name: 📝 Rédacteur de Documentation`
**Exemple JSON :** `"name": "Rédacteur de Documentation"`

### `description`

- **But :** Un résumé court, convivial pour l'utilisateur affiché sous le nom du mode dans l'interface de sélection de mode
- **Format :** Gardez cela concis et focalisé sur ce que le mode fait pour l'utilisateur
- **Affichage UI :** Ce texte apparaît dans le sélecteur de mode redesigné

**Exemple YAML :** `description: Un mode spécialisé pour écrire et éditer de la documentation technique.`
**Exemple JSON :** `"description": "Un mode spécialisé pour écrire et éditer de la documentation technique."`

### `roleDefinition`

- **But :** Description détaillée du rôle, expertise, et personnalité du mode
- **Placement :** Ce texte est placé au début du prompt système quand le mode est actif

**Exemple YAML (multi-lignes) :**

```yaml
roleDefinition: >-
    Vous êtes un ingénieur de tests avec expertise en :
    - Écriture de suites de tests complètes
    - Développement piloté par les tests
```

**Exemple JSON :** `"roleDefinition": "Vous êtes un rédacteur technique spécialisé en documentation claire."`

### `groups`

- **But :** Array/liste définissant quels groupes d'outils le mode peut accéder et toutes restrictions de fichiers
- **Groupes d'Outils Disponibles :** `"read"`, `"edit"`, `"browser"`, `"command"`, `"mcp"`
- **Structure :**
    - Chaîne simple pour accès non restreint : `"edit"`
    - Tuple (array de deux éléments) pour accès restreint : `["edit", { fileRegex: "pattern", description: "optionnel" }]`

**Restrictions de Fichiers pour le groupe "edit" :**

- `fileRegex` : Une chaîne d'expression régulière pour contrôler quels fichiers le mode peut éditer
- En YAML, utilisez typiquement des antislashs simples pour les caractères spéciaux regex (ex. `\.md$`)
- En JSON, les antislashs doivent être échappés doubles (ex. `\\.md$`)
- `description` : Une chaîne optionnelle décrivant la restriction

**Exemple YAML :**

```yaml
groups:
    - read
    - - edit # Premier élément du tuple
      - fileRegex: \.(js|ts)$ # Deuxième élément est l'objet options
        description: Fichiers JS/TS seulement
    - command
```

**Exemple JSON :**

```json
"groups": [
  "read",
  ["edit", { "fileRegex": "\\.(js|ts)$", "description": "Fichiers JS/TS seulement" }],
  "command"
]
```

### `whenToUse` (Optionnel)

- **But :** Fournit des conseils pour la prise de décision automatisée de Kilo, particulièrement pour la sélection de mode et l'orchestration de tâches
- **Format :** Une chaîne décrivant les scénarios idéaux ou types de tâches pour ce mode
- **Usage :** Utilisé par Kilo pour les décisions automatisées et non affiché dans l'interface de sélection de mode

**Exemple YAML :** `whenToUse: Ce mode est meilleur pour le refactoring de code Python.`
**Exemple JSON :** `"whenToUse": "Ce mode est meilleur pour le refactoring de code Python."`

### `customInstructions` (Optionnel)

- **But :** Une chaîne contenant des directives comportementales additionnelles pour le mode
- **Placement :** Ce texte est ajouté près de la fin du prompt système

**Exemple YAML (multi-lignes) :**

```yaml
customInstructions: |-
    Quand vous écrivez des tests :
    - Utilisez des blocs describe/it
    - Includez des descriptions significatives
```

**Exemple JSON :** `"customInstructions": "Focalisez-vous sur expliquer les concepts et fournir des exemples."`

## Avantages du Format YAML

YAML est maintenant le format préféré pour définir les modes personnalisés en raison de plusieurs avantages :

- **Lisibilité :** La structure basée sur l'indentation de YAML est plus facile à lire et comprendre par l'homme
- **Commentaires :** YAML permet les commentaires (lignes commençant par `#`), rendant possible l'annotation de vos définitions de mode
- **Chaînes Multi-lignes :** YAML fournit une syntaxe plus propre pour les chaînes multi-lignes en utilisant `|` (bloc littéral) ou `>` (bloc replié)
- **Moins de Ponctuation :** YAML requiert généralement moins de ponctuation comparé à JSON, réduisant les erreurs de syntaxe
- **Support Éditeur :** La plupart des éditeurs de code modernes fournissent un excellent surlignage de syntaxe et validation pour les fichiers YAML

Tandis que JSON est encore entièrement supporté, les nouveaux modes créés via l'UI ou en demandant à Kilo seront par défaut en YAML.

## Migration vers le Format YAML

### Modes Globaux

La migration automatique de `custom_modes.json` vers `custom_modes.yaml` se produit quand :

- Kilo Code démarre
- Un fichier `custom_modes.json` existe
- Aucun fichier `custom_modes.yaml` n'existe encore

Le processus de migration préserve le fichier JSON original pour les purposes de rollback.

### Modes Projet (`.kilocodemodes`)

- Aucune migration automatique au démarrage ne se produit pour les fichiers spécifiques au projet
- Kilo Code peut lire les fichiers `.kilocodemodes` soit en format YAML soit JSON
- Quand on édite via l'UI, les fichiers JSON seront convertis en format YAML
- Pour la conversion manuelle, vous pouvez demander à Kilo d'aider à reformater les configurations

## Instructions Spécifiques au Mode via Fichiers/Répertoires

Vous pouvez fournir des instructions pour les modes personnalisés en utilisant des fichiers ou répertoires dédiés dans votre espace de travail, permettant une meilleure organisation et contrôle de version.

### Méthode Préférée : Répertoire (`.kilo/rules-{mode-slug}/`)

```
.
├── .kilo/
│   └── rules-redacteur-docs/  # Exemple pour le slug de mode "redacteur-docs"
│       ├── 01-guide-style.md
│       └── 02-formatage.txt
└── ... (autres fichiers de projet)
```

### Méthode Fallback : Fichier Unique (`.kilorules-{mode-slug}`)

```
.
├── .kilorules-redacteur-docs  # Exemple pour le slug de mode "redacteur-docs"
└── ... (autres fichiers de projet)
```

**Portée du Répertoire de Règles :**

- **Modes globaux :** Les règles sont stockées dans `~/.kilo/rules-{slug}/`
- **Modes projet :** Les règles sont stockées dans `{workspace}/.kilo/rules-{slug}/`

La méthode répertoire prend la priorité si elle existe et contient des fichiers. Les fichiers dans le répertoire sont lus récursivement et appendés dans l'ordre alphabétique.

## Priorité de Configuration

Les configurations de mode sont appliquées dans cet ordre :

1. **Configurations de mode au niveau projet** (de `.kilocodemodes` - YAML ou JSON)
2. **Configurations de mode globales** (de `custom_modes.yaml`, puis `custom_modes.json` si YAML non trouvé)
3. **Configurations de mode par défaut**

**Important :** Quand des modes avec le même slug existent à la fois dans `.kilocodemodes` et les paramètres globaux, la version `.kilocodemodes` remplace complètement la globale pour TOUTES les propriétés.

## Remplacer les Modes par Défaut

Vous pouvez remplacer les modes intégrés de Kilo Code (comme 💻 Code, 🪲 Debug, ❓ Ask, 🏗️ Architect, 🪃 Orchestrator) en créant un mode personnalisé avec le même slug.

### Exemple de Remplacement Global

```yaml
customModes:
    - slug: code # Correspond au slug du mode 'code' par défaut
      name: 💻 Code (Remplacement Global)
      roleDefinition: Vous êtes un ingénieur logiciel avec des contraintes spécifiques globales.
      whenToUse: Ce mode de code globalement remplacé est pour les tâches JS/TS.
      customInstructions: Focalisez-vous sur le développement JS/TS spécifique au projet.
      groups:
          - read
          - - edit
            - fileRegex: \.(js|ts)$
              description: Fichiers JS/TS seulement
```

### Exemple de Remplacement Spécifique au Projet

```yaml
customModes:
    - slug: code # Correspond au slug du mode 'code' par défaut
      name: 💻 Code (Spécifique au Projet)
      roleDefinition: Vous êtes un ingénieur logiciel avec des contraintes spécifiques au projet pour ce projet.
      whenToUse: Ce mode de code spécifique au projet est pour les tâches Python dans ce projet.
      customInstructions: Adhérez à PEP8 et utilisez les annotations de type.
      groups:
          - read
          - - edit
            - fileRegex: \.py$
              description: Fichiers Python seulement
          - command
```

## Comprendre les Regex dans les Modes Personnalisés

Les expressions régulières (`fileRegex`) offrent un contrôle fin sur les permissions d'édition de fichiers.

:::tip
**Laissez Kilo Construire Vos Motifs Regex**

Au lieu d'écrire des regex complexes manuellement, demandez à Kilo :

```
Créez un motif regex qui correspond aux fichiers JavaScript mais exclut les fichiers de test
```

Kilo génèrera le motif. Rappelez-vous de l'adapter pour YAML (habituellement antislashs simples) ou JSON (antislashs doubles).
:::

### Règles Importantes pour `fileRegex`

- **Échappement en JSON :** Dans les chaînes JSON, les antislashs (`\`) doivent être échappés doubles (ex. `\\.md$`)
- **Échappement en YAML :** Dans les chaînes YAML non citées ou simplement citées, un antislash simple est usually suffisant pour les caractères spéciaux regex (ex. `\.md$`)
- **Correspondance de Chemin :** Les motifs correspondent contre le chemin de fichier relatif complet depuis la racine de votre espace de travail
- **Sensibilité à la Casse :** Les motifs regex sont sensibles à la casse par défaut
- **Validation :** Les motifs regex invalides sont rejetés avec un message d'erreur "Motif d'expression régulière invalide"

### Exemples de Motifs Communs

| Motif (YAML-like) | Valeur fileRegex JSON | Correspond à                              | Ne Correspond pas                  |
| ----------------- | --------------------- | ----------------------------------------- | ---------------------------------- | -------------------------- | ------------------------------- | -------------------- | ------------------------------ |
| `\.md$`           | `"\\.md$"`            | `readme.md`, `docs/guide.md`              | `script.js`, `readme.md.bak`       |
| `^src/.*`         | `"^src/.*"`           | `src/app.js`, `src/components/button.tsx` | `lib/utils.js`, `test/src/mock.js` |
| `\.(css           | scss)$`               | `"\\.(css                                 | scss)$"`                           | `styles.css`, `theme.scss` | `styles.less`, `styles.css.map` |
| `docs/.*\.md$`    | `"docs/.*\\.md$"`     | `docs/guide.md`, `docs/api/reference.md`  | `guide.md`, `src/docs/notes.md`    |
| `^(?!.\*(test     | spec))\.(js           | ts)$`                                     | `"^(?!.\*(test                     | spec))\\.(js               | ts)$"`                          | `app.js`, `utils.ts` | `app.test.js`, `utils.spec.js` |

### Blocs de Construction Clés Regex

- `\.` : Correspond à un point littéral (YAML: `\.`, JSON: `\\.`)
- `$` : Correspond à la fin de la chaîne
- `^` : Correspond au début de la chaîne
- `.*` : Correspond à n'importe quel caractère (sauf nouvelle ligne) zéro ou plus de fois
- `(a|b)` : Correspond à soit "a" soit "b"
- `(?!...)` :前瞻 négatif

## Gestion d'Erreurs

Quand un mode tente d'éditer un fichier qui ne correspond pas à son motif `fileRegex`, vous verrez une `FileRestrictionError` qui inclut :

- Le nom du mode
- Le motif de fichier autorisé
- La description (si fournie)
- Le chemin de fichier tenté
- L'outil qui a été bloqué

## Exemples de Configurations

### Rédacteur de Documentation de Base (YAML)

```yaml
customModes:
    - slug: redacteur-docs
      name: 📝 Rédacteur de Documentation
      description: Spécialisé pour écrire et éditer de la documentation technique
      roleDefinition: Vous êtes un rédacteur technique spécialisé en documentation claire
      groups:
          - read
          - - edit
            - fileRegex: \.md$
              description: Fichiers Markdown seulement
      customInstructions: Focalisez-vous sur les explications claires et exemples
```

### Ingénieur de Tests avec Restrictions de Fichiers (YAML)

```yaml
customModes:
    - slug: ingenieur-tests
      name: 🧪 Ingénieur de Tests
      description: Focalisé sur l'écriture et la maintenance de suites de tests
      roleDefinition: Vous êtes un ingénieur de tests focalisé sur la qualité de code
      whenToUse: Utilisez pour écrire des tests, déboguer les échecs de tests, et améliorer la couverture de tests
      groups:
          - read
          - - edit
            - fileRegex: \.(test|spec)\.(js|ts)$
              description: Fichiers de test seulement
          - command
```

### Mode Révision de Sécurité (YAML)

```yaml
customModes:
    - slug: revision-securite
      name: 🔒 Réviseur de Sécurité
      description: Analyse de sécurité en lecture seule et évaluation de vulnérabilités
      roleDefinition: Vous êtes un spécialiste en sécurité révisant le code pour des vulnérabilités
      whenToUse: Utilisez pour les révisions de sécurité et évaluations de vulnérabilités
      customInstructions: |-
          Focalisez-vous sur :
          - Problèmes de validation d'entrée
          - Faiblesses d'authentification et autorisation
          - Risques d'exposition de données
          - Vulnérabilités d'injection
      groups:
          - read
          - browser
```

## Dépannage

### Problèmes Communs

- **Mode n'apparaissant pas :** Après avoir créé ou importé un mode, vous pourriez avoir besoin de recharger la fenêtre VS Code
- **Motifs regex invalides :** Testez vos motifs en utilisant des testeurs regex en ligne avant de les appliquer
- **Confusion de priorité :** Rappelez-vous que les modes projet remplacent complètement les modes globaux avec le même slug
- **Erreurs de syntaxe YAML :** Utilisez l'indentation appropriée (espaces, pas d'onglets) et validez votre YAML

### Conseils pour Travailler avec YAML

- **L'Indentation est Clé :** YAML utilise l'indentation (espaces, pas d'onglets) pour définir la structure
- **Deux-points pour les Paires Clé-Valeur :** Les clés doivent être suivies par un deux-points et un espace (ex. `slug: mon-mode`)
- **Trait d'union pour les Éléments de Liste :** Les éléments de liste commencent par un trait d'union et un espace (ex. `- read`)
- **Validez Votre YAML :** Utilisez des validateurs YAML en ligne ou la validation intégrée de votre éditeur

## Galerie Communautaire

Prêt à explorer plus ? Consultez [Show and Tell](https://github.com/Kilo-Org/kilocode/discussions/categories/show-and-tell) pour découvrir et partager des modes personnalisés créés par la communauté !
