---
title: MCP vs API
sidebar_label: MCP vs API
---

# MCP vs APIs REST : Une Distinction Fondamentale

Comparer les APIs REST au Protocole de Contexte Modèle (MCP) est une erreur de catégorie. Ils opèrent à différentes couches d'abstraction et servent des purposes fondamentalement différents dans les systèmes IA.

## Différences Architecturales

| Fonctionnalité         | MCP                                                              | APIs REST                                                                     |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Gestion d'État         | **Avec État** - maintient le contexte à travers les interactions | **Sans État** - chaque requête est indépendante                               |
| Type de Connexion      | Connexions persistantes, bidirectionnelles                       | Requête/réponse unidirectionnelle                                             |
| Style de Communication | Basé JSON-RPC avec sessions continues                            | Basé HTTP avec requêtes discrètes                                             |
| Gestion de Contexte    | Le contexte est intrinsèque au protocole                         | Le contexte doit être géré manuellement                                       |
| Découverte d'Outils    | Découverte à l'exécution des outils disponibles                  | Intégration au moment de la conception nécessitant une connaissance préalable |
| Approche d'Intégration | Intégration à l'exécution avec capacités dynamiques              | Intégration au moment de la conception nécessitant des changements de code    |

## Différentes Couches, Différents Buts

Les APIs REST et MCP servent différents niveaux dans la pile technologique :

1. **REST** : Pattern de communication web de bas niveau qui expose les opérations sur les ressources
2. **MCP** : Protocole IA de haut niveau qui orchestre l'utilisation d'outils et maintient le contexte

MCP utilise souvent les APIs REST en interne, mais les abstrait pour l'IA. Think of MCP as middleware that turns discrete web services into a cohesive environment the IA can operate within.

## Préservation de Contexte : Critique pour les Workflows IA

Le design avec état de MCP résout une limitation clé du REST dans les applications IA :

- **Approche REST** : Chaque appel est isolé, nécessitant un passage manuel de contexte entre les étapes
- **Approche MCP** : Un contexte de conversation persiste à travers plusieurs utilisations d'outils

Par exemple, un IA déboguant une base de code peut ouvrir un fichier, exécuter des tests, et identifier des erreurs sans perdre le contexte entre les étapes. La session MCP maintient la conscience des actions et résultats précédents.

## Découverte Dynamique d'Outils

MCP permet à une IA de découvrir et utiliser des outils à l'exécution :

```json
// IA découvre les outils disponibles
{
	"tools": [
		{
			"name": "readFile",
			"description": "Lit le contenu d'un fichier",
			"parameters": {
				"path": { "type": "string", "description": "Chemin de fichier" }
			}
		},
		{
			"name": "createTicket",
			"description": "Crée un ticket dans le traceur de problèmes",
			"parameters": {
				"title": { "type": "string" },
				"description": { "type": "string" }
			}
		}
	]
}
```

Cette capacité "plug-and-play" permet d'ajouter de nouveaux outils sans redéployer ou modifier l'IA elle-même.

## Exemple du Monde Réel : Workflow Multi-Outils

Considérez une tâche nécessitant plusieurs services : "Vérifier les commits récents, créer un ticket JIRA pour la correction de bogue, et publier sur Slack."

**Approche basée REST** :

- Nécessite des intégrations séparées pour les APIs Git, JIRA, et Slack
- A besoin de code personnalisé pour gérer le contexte entre les appels
- Se casse si n'importe quel service change son API

**Approche basée MCP** :

- Un protocole unifié pour tous les outils
- Maintient le contexte à travers tout le workflow
- De nouveaux outils peuvent être échangés sans changements de code

## Pourquoi Kilo Code Utilise MCP

Kilo Code exploite MCP pour fournir :

1. **Extensibilité** : Ajouter des outils personnalisés illimités sans attendre l'intégration officielle
2. **Conscience contextuelle** : Les outils peuvent accéder à l'historique de conversation et au contexte de projet
3. **Intégration simplifiée** : Un protocole standard plutôt que de nombreux patterns API
4. **Flexibilité d'exécution** : Découvrir et utiliser de nouvelles capacités à la volée

MCP crée un connecteur universel entre Kilo Code et les services externes, avec les APIs REST often powering those services behind the scenes.

## Conclusion : Technologies Complémentaires, Pas Concurrentes

MCP ne remplace pas les APIs REST - il s'appuie sur elles. REST excelle à fournir des services discrets, tandis que MCP excelle à orchestrer ces services pour les agents IA.

La distinction critique est que MCP est natif-IA : il traite le modèle comme un utilisateur de première classe, fournissant la couche d'interaction contextuelle et avec état dont les agents IA ont besoin pour fonctionner efficacement dans des environnements complexes.
