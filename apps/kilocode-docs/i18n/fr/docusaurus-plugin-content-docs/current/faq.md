---
---

import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import { DISCORD_URL } from '@site/src/constants.ts'

# Questions Fréquemment Posées

Cette page répond à certaines questions courantes sur Kilo Code.

## Général

### Qu'est-ce que Kilo Code ?

Kilo Code est une extension d'agent IA open-source pour Visual Studio Code. Elle vous aide à écrire du code plus efficacement en générant du code, en automatisant des tâches et en fournissant des suggestions.

### Comment fonctionne Kilo Code ?

Kilo Code utilise des grands modèles de langage (LLM) pour comprendre vos requêtes et les traduire en actions. Il peut :

- Lire et écrire des fichiers dans votre projet.
- Exécuter des commandes dans votre terminal VS Code.
- Effectuer une navigation web (si activé).
- Utiliser des outils externes via le Model Context Protocol (MCP).

Vous interagissez avec Kilo Code via une interface de chat, où vous fournissez des instructions et examinez/approuvez ses actions proposées.

### Que peut faire Kilo Code ?

Kilo Code peut aider avec une variété de tâches de codage, notamment :

- Générer du code à partir de descriptions en langage naturel.
- Refactoriser du code existant.
- Corriger des bugs.
- Écrire de la documentation.
- Expliquer du code.
- Répondre à des questions sur votre base de code.
- Automatiser des tâches répétitives.
- Créer de nouveaux fichiers et projets.

### Kilo Code est-il gratuit à utiliser ?

L'extension Kilo Code elle-même est gratuite et open-source. Pour que Kilo Code soit utile, vous avez besoin d'un modèle IA pour répondre à vos requêtes. Les modèles sont hébergés par des fournisseurs et la plupart facturent l'accès.

Il existe quelques modèles disponibles gratuitement. L'ensemble des modèles gratuits change constamment en fonction des décisions de tarification des fournisseurs.

Vous pouvez également utiliser Kilo Code avec un [modèle local](advanced-usage/local-models) ou "Apportez Votre Propre Clé API" pour [un autre fournisseur de modèles](getting-started/connecting-api-provider) (comme [Anthropic](providers/anthropic), [OpenAI](providers/openai), [OpenRouter](providers/openrouter), [Requesty](providers/requesty), etc.).

### Comment payer pour l'utilisation des modèles via Kilo Code ?

Si vous choisissez de payer pour les modèles via Kilo Code, vous le faites en achetant des Kilo Credits. Vous pouvez [acheter des Kilo Credits](basic-usage/adding-credits) en toute sécurité via Stripe avec une carte de crédit. Nous n'appliquons aucune majoration sur les Kilo Credits. 1$ que vous nous donnez équivaut à 1$ en Kilo Credits.

L'utilisation des modèles est mesurée par les fournisseurs en termes de différents types de tokens. Lorsque vous utilisez un modèle, nous débitons vos Kilo credits du montant que le fournisseur nous facture -- sans majoration.

Vous pouvez utiliser tous les modèles que vous aimez tant que vous avez des crédits sur votre compte. Lorsque vous n'avez plus de crédits, vous pouvez en ajouter. C'est aussi simple que ça !

Si vous cherchez à gagner quelques crédits, vous pourriez rejoindre notre <a href={DISCORD_URL} target='_blank'>Discord</a> où nous avons parfois des offres promotionnelles !

### Quels sont les risques d'utiliser Kilo Code ?

Kilo Code est un outil puissant, et il est important de l'utiliser de manière responsable. Voici quelques points à garder à l'esprit :

- **Kilo Code peut faire des erreurs.** Examinez toujours attentivement les changements proposés par Kilo Code avant de les approuver.
- **Kilo Code peut exécuter des commandes.** Soyez très prudent en autorisant Kilo Code à exécuter des commandes, surtout si vous utilisez l'auto-approbation.
- **Kilo Code peut accéder à Internet.** Si vous utilisez un fournisseur qui supporte la navigation web, soyez conscient que Kilo Code pourrait potentiellement accéder à des informations sensibles.

## Configuration & Installation

### Comment installer Kilo Code ?

Consultez le [Guide d'Installation](/getting-started/installing) pour des instructions détaillées.

### Quels fournisseurs d'API sont supportés ?

Kilo Code supporte une large gamme de fournisseurs d'API, notamment :

- [Anthropic (Claude)](/providers/kilocode)
- [Anthropic (Claude)](/providers/anthropic)
- [OpenAI](/providers/openai)
- [OpenRouter](/providers/openrouter)
- [Google Gemini](/providers/gemini)
- [Glama](/providers/glama)
- [AWS Bedrock](/providers/bedrock)
- [GCP Vertex AI](/providers/vertex)
- [Ollama](/providers/ollama)
- [LM Studio](/providers/lmstudio)
- [DeepSeek](/providers/deepseek)
- [Mistral](/providers/mistral)
- [Unbound](/providers/unbound)
- [Requesty](/providers/requesty)
- [VS Code Language Model API](/providers/vscode-lm)

### Comment obtenir une clé API ?

Chaque fournisseur d'API a son propre processus pour obtenir une clé API. Consultez la [Configuration de Votre Premier Fournisseur IA](/getting-started/connecting-api-provider) pour des liens vers la documentation pertinente pour chaque fournisseur.

### Puis-je utiliser Kilo Code avec des modèles locaux ?

Oui, Kilo Code supporte l'exécution de modèles localement en utilisant [Ollama](/providers/ollama) et [LM Studio](/providers/lmstudio). Consultez [Utilisation de Modèles Locaux](/advanced-usage/local-models) pour des instructions.

## Utilisation

### Comment démarrer une nouvelle tâche ?

Ouvrez le panneau Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) et tapez votre tâche dans la boîte de chat. Soyez clair et spécifique sur ce que vous voulez que Kilo Code fasse. Consultez [L'Interface de Chat](/basic-usage/the-chat-interface) pour les meilleures pratiques.

### Que sont les modes dans Kilo Code ?

Les [Modes](/basic-usage/using-modes) sont différentes personnalités que Kilo Code peut adopter, chacune avec un focus spécifique et un ensemble de capacités. Les modes intégrés sont :

- **Code :** Pour les tâches de codage généralistes.
- **Architect :** Pour la planification et le leadership technique.
- **Ask :** Pour répondre aux questions et fournir des informations.
- **Debug :** Pour le diagnostic systématique de problèmes.
  Vous pouvez également créer [Modes Personnalisés](/features/custom-modes).

### Comment basculer entre les modes ?

Utilisez le menu déroulant dans la zone de saisie du chat pour sélectionner un mode différent, ou utilisez la commande `/` pour basculer vers un mode spécifique.

### Que sont les outils et comment les utiliser ?

Les [Outils](/basic-usage/how-tools-work) sont le moyen par lequel Kilo Code interagit avec votre système. Kilo Code sélectionne et utilise automatiquement les outils appropriés pour accomplir vos tâches. Vous n'avez pas besoin d'appeler les outils directement. Vous serez invité à approuver ou rejeter chaque utilisation d'outil.

### Que sont les mentions de contexte ?

Les [mentions de contexte](/basic-usage/context-mentions) sont un moyen de fournir à Kilo Code des informations spécifiques sur votre projet, telles que des fichiers, des dossiers ou des problèmes. Utilisez le symbole "@" suivi de l'élément que vous voulez mentionner (ex: `@/src/file.ts`, `@problems`).

### Kilo Code peut-il accéder à Internet ?

Oui, si vous utilisez un fournisseur avec un modèle qui supporte la navigation web. Soyez conscient des implications de sécurité en autorisant cela.

### Kilo Code peut-il exécuter des commandes dans mon terminal ?

Oui, Kilo Code peut exécuter des commandes dans votre terminal VS Code. Vous serez invité à approuver chaque commande avant son exécution, sauf si vous avez activé l'auto-approbation pour les commandes. Soyez extrêmement prudent en approuvant automatiquement les commandes. Si vous rencontrez des problèmes avec les commandes du terminal, consultez le [Guide d'Intégration Shell](/features/shell-integration) pour le dépannage.

### Comment fournir un retour à Kilo Code ?

Vous pouvez fournir un retour en approuvant ou rejetant les actions proposées par Kilo Code. Vous pouvez fournir un retour supplémentaire en utilisant le champ de retour.

### Puis-je personnaliser le comportement de Kilo Code ?

Oui, vous pouvez personnaliser Kilo Code de plusieurs manières :

- **Instructions Personnalisées :** Fournissez des instructions générales qui s'appliquent à tous les modes, ou des instructions spécifiques à un mode.
- **Modes Personnalisés :** Créez vos propres modes avec des invites et des permissions d'outils adaptées.
- **Fichiers `.clinerules` :** Créez des fichiers `.clinerules` dans votre projet pour fournir des directives supplémentaires.
- **Paramètres :** Ajustez divers paramètres, tels que l'auto-approbation, l'édition diff, et plus encore.

### Kilo Code a-t-il des paramètres d'auto-approbation ?

Oui, Kilo Code a quelques paramètres qui, lorsqu'ils sont activés, approuveront automatiquement les actions. En savoir plus [ici](/features/auto-approving-actions).

## Fonctionnalités Avancées

### Puis-je utiliser Kilo Code hors ligne ?

Oui, si vous utilisez un [modèle local](/advanced-usage/local-models).

### Qu'est-ce que MCP (Model Context Protocol) ?

[MCP](/features/mcp/overview) est un protocole qui permet à Kilo Code de communiquer avec des serveurs externes, étendant ses capacités avec des outils et ressources personnalisés.

### Puis-je créer mes propres serveurs MCP ?

Oui, vous pouvez créer vos propres serveurs MCP pour ajouter des fonctionnalités personnalisées à Kilo Code. Consultez la [documentation MCP](https://github.com/modelcontextprotocol) pour les détails.
Oui, vous pouvez créer vos propres serveurs MCP pour ajouter des fonctionnalités personnalisées à Kilo Code. Consultez la [documentation MCP](https://github.com/modelcontextprotocol) pour les détails.

## Dépannage

### Kilo Code ne répond pas. Que devrais-je faire ?

- Assurez-vous que votre clé API est correcte et n'a pas expiré.
- Vérifiez votre connexion Internet.
- Vérifiez le statut de votre fournisseur d'API choisi.
- Essayez de redémarrer VS Code.
- Si le problème persiste, signalez le problème sur [GitHub](https://github.com/Kilo-Org/kilocode/issues) ou [Discord](https://kilocode.ai/discord).

### Je vois un message d'erreur. Que signifie-t-il ?

Le message d'erreur devrait fournir quelques informations sur le problème. Si vous n'êtes pas sûr de comment le résoudre, cherchez de l'aide dans les forums communautaires.

### Kilo Code a fait des changements que je ne voulais pas. Comment les annuler ?

Kilo Code utilise les capacités d'édition de fichiers intégrées de VS Code. Vous pouvez utiliser la commande standard "Annuler" (Ctrl/Cmd + Z) pour annuler les changements. De plus, si les points de contrôle expérimentaux sont activés, Kilo peut annuler les changements faits à un fichier.

### Comment signaler un bug ou suggérer une fonctionnalité ?

Veuillez signaler des bugs ou suggérer des fonctionnalités sur la page [Issues](https://github.com/Kilo-Org/kilocode/issues) et la page [Demandes de Fonctionnalités](https://github.com/Kilo-Org/kilocode/discussions/categories/ideas) de Kilo Code.
