# Configuration de Lancement Automatique

La Configuration de Lancement Automatique vous permet de démarrer automatiquement une tâche Kilo Code à l'ouverture d'un espace de travail, avec support pour des profils et modes spécifiques. Ceci a été développé à l'origine comme une fonctionnalité de test interne, mais nous avons décidé de l'exposer aux utilisateurs au cas où quelqu'un la trouverait utile !

:::info
La Configuration de Lancement Automatique est particulièrement utile pour tester le même prompt contre plusieurs modèles ou répertoires de projets.
:::

## Comment ça fonctionne

Quand vous ouvrez un espace de travail dans VS Code, Kilo Code vérifie automatiquement s'il y a un fichier de configuration de lancement JSON. S'il en trouve un, il :

- Bascule vers le profil de fournisseur spécifié (si fourni)
- Change vers le mode spécifié (si fourni)
- Lance une tâche avec votre prompt prédéfini

Ceci se produit de manière transparente en arrière-plan, sans intervention manuelle nécessaire.

## Créer une Configuration de Lancement

### Configuration de Base

1. Créez un répertoire `.kilocode` dans la racine de votre espace de travail (s'il n'existe pas)
2. Créez un fichier `launchConfig.json` à l'intérieur du répertoire `.kilocode`
3. Configurez vos paramètres de lancement en utilisant le format JSON ci-dessous

### Format de Configuration

```json
{
	"prompt": "Votre description de tâche ici",
	"profile": "Nom de Profil (optionnel)",
	"mode": "nom-mode (optionnel)"
}
```

#### Champs Requis

- **`prompt`** (string) : Le message de tâche qui sera envoyé à l'IA quand l'espace de travail s'ouvre

#### Champs Optionnels

- **`profile`** (string) : Nom d'un [Profil de Configuration API](/features/api-configuration-profiles) existant à utiliser pour cette tâche. Doit correspondre exactement à un nom de profil de vos paramètres.

- **`mode`** (string) : Le mode Kilo Code à utiliser pour cette tâche. Modes disponibles :
    - `"code"` - Tâches de codage générales
    - `"architect"` - Planification et design technique
    - `"ask"` - Questions et explications
    - `"debug"` - Diagnostic de problèmes et dépannage
    - `"test"` - Flux de travail axés sur les tests
    - Slugs de mode personnalisés (si vous avez des [modes personnalisés](/features/custom-modes))

## Exemples de Configurations

### Lancement de Tâche de Base

```json
{
	"prompt": "Réviser cette base de code et suggérer des améliorations pour les performances et la maintenabilité"
}
```

### Tâche Spécifique à un Profil

```json
{
	"prompt": "Créer des tests unitaires complets pour tous les composants dans le répertoire src/",
	"profile": "GPT-4 Turbo"
}
```

### Planification d'Architecture avec Claude

```json
{
	"prompt": "Concevoir une architecture de microservices évolutive pour cette plateforme e-commerce avec focus sur la sécurité et les performances",
	"profile": "🎻 Sonnet 4",
	"mode": "architect"
}
```

### Configuration de Comparaison de Modèles

```json
{
	"prompt": "Optimiser cet algorithme pour une meilleure complexité temporelle et expliquer votre approche",
	"profile": "🧠 Qwen",
	"mode": "code"
}
```

## Cas d'Utilisation

### Flux de Développement

- **Templates de Projets** : Incluez les configurations de lancement dans les templates de projet pour commencer immédiatement avec l'assistance IA appropriée
- **Révisions de Code** : Déclenchez automatiquement les tâches de révision de code à l'ouverture des branches de pull request
- **Documentation** : Lancez les tâches de génération de documentation pour les nouveaux projets

### Tests et Comparaison

- **Tests de Modèles** : Créez différentes configurations pour tester comment divers modèles IA gèrent le même prompt
- **Tests A/B** : Comparez les approches en basculant entre différents profils et modes
- **Benchmarking** : Testez systématiquement les performances IA à travers différents scénarios

### Collaboration d'Équipe

- **Configuration Cohérente** : Assurez-vous que tous les membres d'équipe utilisent la même configuration IA pour des projets spécifiques
- **Onboarding** : Aidez les nouveaux membres d'équipe à commencer avec des paramètres IA optimaux automatiquement
- **Standards** : Appliquez les standards de codage en lançant avec des profils et modes spécifiques

## Emplacement du Fichier

Le fichier de configuration doit être located à :

```
your-workspace/
└── .kilocode/
    └── launchConfig.json
```

Ce fichier devrait être à la racine de votre espace de travail (au même niveau que vos fichiers de projet principaux).

## Comportement et Timing

- Le lancement automatique se déclenche approximativement 500ms après l'activation de l'extension Kilo Code
- La barre latérale reçoit automatiquement le focus avant que la tâche ne se lance
- Le changement de profil se produit avant le changement de mode (si les deux sont spécifiés)
- La tâche se lance après que tous les changements de configuration soient appliqués
- Si le changement de profil ou de mode échoue, la tâche continue avec les paramètres actuels

## Dépannage

### Configuration qui ne se Charge Pas

1. Vérifiez l'emplacement du fichier : `.kilocode/launchConfig.json` dans la racine de l'espace de travail
2. Vérifiez la syntaxe JSON avec un validateur JSON
3. Assurez-vous que le champ `prompt` est présent et non vide
4. Vérifiez la Console Développeur VS Code pour les messages d'erreur

### Profil qui ne Change Pas

1. Vérifiez que le nom du profil correspond exactement à un de vos paramètres
2. Les noms de profil sont sensibles à la casse et doivent correspondre exactement (y compris les émojis)
3. Vérifiez que le profil existe dans vos [Profils de Configuration API](/features/api-configuration-profiles)

### Mode qui ne Change Pas

1. Vérifiez que le nom de mode est valide (code, architect, ask, debug, test)
2. Pour les modes personnalisés, utilisez le slug de mode exact de votre configuration
3. Les noms de mode sont sensibles à la casse et devraient être en minuscules
