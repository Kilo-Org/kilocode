---
title: Utiliser MCP dans Kilo Code
sidebar_label: Utiliser MCP dans Kilo Code
---

# Utiliser MCP dans Kilo Code

Le Protocole de Contexte Modèle (MCP) étend les capacités de Kilo Code en se connectant à des outils et services externes. Ce guide couvre tout ce que vous devez savoir sur l'utilisation de MCP avec Kilo Code.

<YouTubeEmbed
  url="https://youtu.be/6O9RQoQRX8A"
  caption="Démontrer l'installation MCP dans Kilo Code"
/>

## Configurer les Serveurs MCP

Les configurations de serveur MCP peuvent être gérées à deux niveaux :

1.  **Configuration Globale** : Stockée dans le fichier `mcp_settings.json`, accessible via les paramètres VS Code (voir ci-dessous). Ces paramètres s'appliquent à travers tous vos espaces de travail à moins d'être surchargés par une configuration niveau projet.
2.  **Configuration Niveau Projet** : Définie dans un fichier `.kilocode/mcp.json` dans le répertoire racine de votre projet. Cela vous permet de configurer des serveurs spécifiques au projet et de partager les configurations avec votre équipe en committant le fichier dans le contrôle de version. Kilo Code détecte et charge automatiquement ce fichier s'il existe.

**Priorité** : Si un nom de serveur existe dans les configurations globales et de projet, la **configuration niveau projet a priorité**.

### Éditer les Fichiers de Paramètres MCP

Vous pouvez éditer les deux fichiers de configuration MCP globaux et niveau projet directement depuis la vue des paramètres MCP Kilo Code.

1. Cliquez sur l'icône <Codicon name="gear" /> dans la navigation supérieure du panneau Kilo Code pour ouvrir `Paramètres`.
2. Cliquez sur l'onglet `Serveurs MCP` sur le côté gauche
3. Choisissez les serveurs `Installés`
4. Cliquez sur le bouton approprié :
    - **`Éditer MCP Global`** : Ouvre le fichier global `mcp_settings.json`.
    - **`Éditer MCP Projet`** : Ouvre le fichier `.kilocode/mcp.json` spécifique au projet. Si ce fichier n'existe pas, Kilo Code le créera pour vous.

  <img src="/docs/img/using-mcp-in-kilo-code/mcp-installed-config.png" alt="Boutons Éditer MCP Global et Éditer MCP Projet" width="600" />

Les deux fichiers utilisent un format JSON avec un objet `mcpServers` contenant les configurations de serveur nommées :

```json
{
	"mcpServers": {
		"server1": {
			"command": "python",
			"args": ["/path/to/server.py"],
			"env": {
				"API_KEY": "your_api_key"
			},
			"alwaysAllow": ["tool1", "tool2"],
			"disabled": false
		}
	}
}
```

_Exemple de configuration de Serveur MCP dans Kilo Code (Transport STDIO)_

### Comprendre les Types de Transport

MCP supporte trois types de transport pour la communication serveur :

#### Transport STDIO

Utilisé pour les serveurs locaux s'exécutant sur votre machine :

- Communique via les flux d'entrée/sortie standard
- Latence plus faible (pas de surcharge réseau)
- Meilleure sécurité (pas d'exposition réseau)
- Configuration plus simple (pas de serveur HTTP nécessaire)
- S'exécute comme un processus enfant sur votre machine

Pour plus d'informations approfondies sur comment le transport STDIO fonctionne, voir [Transport STDIO](/features/mcp/server-transports#stdio-transport).

Exemple de configuration STDIO :

```json
{
	"mcpServers": {
		"local-server": {
			"command": "node",
			"args": ["/path/to/server.js"],
			"env": {
				"API_KEY": "your_api_key"
			},
			"alwaysAllow": ["tool1", "tool2"],
			"disabled": false
		}
	}
}
```

#### Transport HTTP Streamable

Utilisé pour les serveurs distants accédés sur HTTP/HTTPS :

- Peut être hébergé sur une machine différente
- Supporte plusieurs connexions client
- Nécessite un accès réseau
- Permet le déploiement et la gestion centralisés

Exemple de configuration de transport HTTP streamable :

```json
{
	"mcpServers": {
		"remote-server": {
			"type": "streamable-http",
			"url": "https://your-server-url.com/mcp",
			"headers": {
				"Authorization": "Bearer your-token"
			},
			"alwaysAllow": ["tool3"],
			"disabled": false
		}
	}
}
```

#### Transport SSE

    ⚠️ DÉPRÉCIÉ : Le Transport SSE a été déprécié à partir de la version de spécification MCP 2025-03-26. Veuillez utiliser le Transport HTTP Stream à la place, qui implémente la nouvelle spécification de transport HTTP Streamable.

Utilisé pour les serveurs distants accédés sur HTTP/HTTPS :

- Communique via le protocole Événements Envoyés par Serveur
- Peut être hébergé sur une machine différente
- Supporte plusieurs connexions client
- Nécessite un accès réseau
- Permet le déploiement et la gestion centralisés

Pour plus d'informations approfondies sur comment le transport SSE fonctionne, voir [Transport SSE](/features/mcp/server-transports#sse-transport).

Exemple de configuration SSE :

```json
{
	"mcpServers": {
		"remote-server": {
			"url": "https://your-server-url.com/mcp",
			"headers": {
				"Authorization": "Bearer your-token"
			},
			"alwaysAllow": ["tool3"],
			"disabled": false
		}
	}
}
```

### Supprimer un Serveur

1. Appuyez sur <Codicon name="trash" /> à côté du serveur MCP que vous aimeriez supprimer
2. Appuyez sur le bouton `Supprimer` sur la boîte de confirmation

  <img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-5.png" alt="Boîte de confirmation de suppression" width="400" />

### Redémarrer un Serveur

1. Appuyez sur le bouton <Codicon name="refresh" /> à côté du serveur MCP que vous aimeriez redémarrer

### Activer ou Désactiver un Serveur

1. Appuyez sur le commutateur de basculement <Codicon name="activate" /> à côté du serveur MCP pour l'activer/le désactiver

### Timeout Réseau

Pour définir le temps maximum d'attente pour une réponse après un appel d'outil au serveur MCP :

1. Cliquez sur le menu déroulant `Timeout Réseau` au bas de la boîte de configuration du serveur MCP individuel et changez le temps. Par défaut est 1 minute mais il peut être réglé entre 30 secondes et 5 minutes.

<img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-6.png" alt="Menu déroulant Timeout Réseau" width="400" />

### Outils d'Auto-Approbation

L'auto-approbation d'outil MCP fonctionne sur une base par outil et est désactivée par défaut. Pour configurer l'auto-approbation :

1. D'abord activez l'option d'auto-approbation globale "Utiliser les serveurs MCP" dans [auto-approving-actions](/features/auto-approving-actions)
2. Dans les paramètres du serveur MCP, localisez l'outil spécifique que vous voulez auto-approuver
3. Cochez la case `Toujours autoriser` à côté du nom de l'outil

<img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-7.png" alt="Case à cocher Toujours autoriser pour les outils MCP" width="120" />

Quand activé, Kilo Code approuvera automatiquement cet outil spécifique sans demander. Notez que le paramètre global "Utiliser les serveurs MCP" a priorité - s'il est désactivé, aucun outil MCP ne sera auto-approuvé.

## Trouver et Installer les Serveurs MCP

Kilo Code ne vient avec aucun serveur MCP pré-installé. Vous devrez les trouver et les installer séparément.

- **Référentiels Communautaires :** Vérifiez les listes maintenues par la communauté des serveurs MCP sur GitHub
- **Demandez à Kilo Code :** Vous pouvez demander à Kilo Code de vous aider à trouver ou même créer des serveurs MCP
- **Construisez le Vôtre :** Créez des serveurs MCP personnalisés en utilisant le SDK pour étendre Kilo Code avec vos propres outils

Pour la documentation SDK complète, visittez le [référentiel MCP GitHub](https://github.com/modelcontextprotocol/).

## Utiliser les Outils MCP dans Votre Workflow

Après avoir configuré un serveur MCP, Kilo Code détectera automatiquement les outils et ressources disponibles. Pour les utiliser :

1. Tapez votre requête dans l'interface de chat Kilo Code
2. Kilo Code identifiera quand un outil MCP peut aider avec votre tâche
3. Approuvez l'utilisation de l'outil quand demandé (ou utilisez l'auto-approbation)

Exemple : "Analyser la performance de mon API" pourrait utiliser un outil MCP qui teste les points de terminaison API.

## Dépanner les Serveurs MCP

Problèmes communs et solutions :

- **Serveur Ne Répondant Pas :** Vérifiez si le processus serveur fonctionne et vérifiez la connectivité réseau
- **Erreurs de Permission :** Assurez-vous que les clés API et identifiants appropriés sont configurés dans votre `mcp_settings.json` (pour les paramètres globaux) ou `.kilocode/mcp.json` (pour les paramètres projet).
- **Outil Non Disponible :** Confirmez que le serveur implémente correctement l'outil et qu'il n'est pas désactivé dans les paramètres.
- **Performance Lente :** Essayez d'ajuster la valeur de timeout réseau pour le serveur MCP spécifique.

## Exemples de Configuration MCP Spécifiques à la Plateforme

### Exemple de Configuration Windows

Quand vous configurez les serveurs MCP sur Windows, vous devrez utiliser l'Invite de Commandes Windows (`cmd`) pour exécuter les commandes. Voici un exemple de configuration d'un serveur MCP Puppeteer sur Windows :

```json
{
	"mcpServers": {
		"puppeteer": {
			"command": "cmd",
			"args": ["/c", "npx", "-y", "@modelcontextprotocol/server-puppeteer"]
		}
	}
}
```

Cette configuration spécifique à Windows :

- Utilise la commande `cmd` pour accéder à l'Invite de Commandes Windows
- Utilise `/c` pour dire à cmd d'exécuter la commande puis de se terminer
- Utilise `npx` pour exécuter le package sans l'installer de façon permanente
- Le drapeau `-y` répond automatiquement "oui" à toutes les invites pendant l'installation
- Exécute le package `@modelcontextprotocol/server-puppeteer` qui fournit des capacités d'automatisation de navigateur

:::note
Pour macOS ou Linux, vous utiliseriez une configuration différente :

```json
{
	"mcpServers": {
		"puppeteer": {
			"command": "npx",
			"args": ["-y", "@modelcontextprotocol/server-puppeteer"]
		}
	}
}
```

:::

La même approche peut être utilisée pour d'autres serveurs MCP sur Windows, en ajustant le nom de package selon les besoins pour différents types de serveur.
