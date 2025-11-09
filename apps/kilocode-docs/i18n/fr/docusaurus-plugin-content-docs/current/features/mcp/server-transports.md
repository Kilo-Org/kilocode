---
title: Transports Serveur MCP
sidebar_label: Transports STDIO & SSE
---

# Transports Serveur MCP : STDIO & SSE

Le Protocole de Contexte Modèle (MCP) supporte deux mécanismes de transport primaires pour la communication entre Kilo Code et les serveurs MCP : Entrée/Sortie Standard (STDIO) et Événements Envoyés par Serveur (SSE). Chacun a des caractéristiques distinctes, avantages, et cas d'usage.

## Transport STDIO

Le transport STDIO s'exécute localement sur votre machine et communique via les flux d'entrée/sortie standard.

### Comment le Transport STDIO Fonctionne

1. Le client (Kilo Code) lance un serveur MCP comme un processus enfant
2. La communication se fait à travers les flux de processus : le client écrit au STDIN du serveur, le serveur répond au STDOUT
3. Chaque message est délimité par un caractère de nouvelle ligne
4. Les messages sont formatés comme JSON-RPC 2.0

```
Client                    Serveur
  |                         |
  |---- message JSON ------>| (via STDIN)
  |                         | (traite la requête)
  |<---- message JSON ------| (via STDOUT)
  |                         |
```

### Caractéristiques STDIO

- **Localité** : S'exécute sur la même machine que Kilo Code
- **Performance** : Très faible latence et surcharge (aucune pile réseau impliquée)
- **Simplicité** : Communication directe de processus sans configuration réseau
- **Relation** : Relation un-à-un entre client et serveur
- **Sécurité** : Inhérentement plus sécurisé car pas d'exposition réseau

### Quand Utiliser STDIO

Le transport STDIO est idéal pour :

- Les intégrations locales et outils s'exécutant sur la même machine
- Les opérations sensibles à la sécurité
- Les exigences de faible latence
- Les scénarios client unique (une instance Kilo Code par serveur)
- Les outils de ligne de commande ou extensions IDE

### Exemple d'Implémentation STDIO

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

const server = new Server({ name: "local-server", version: "1.0.0" })
// Enregistrer les outils...

// Utiliser le transport STDIO
const transport = new StdioServerTransport(server)
transport.listen()
```

## Transport SSE

Le transport Événements Envoyés par Serveur (SSE) s'exécute sur un serveur distant et communique sur HTTP/HTTPS.

### Comment le Transport SSE Fonctionne

1. Le client (Kilo Code) se connecte au point de terminaison SSE du serveur via requête HTTP GET
2. Cela établit une connexion persistante où le serveur peut pousser des événements au client
3. Pour la communication client-vers-serveur, le client fait des requêtes HTTP POST à un point de terminaison séparé
4. La communication se fait sur deux canaux :
    - Flux d'Événements (GET) : Mises à jour serveur-vers-client
    - Point de Terminaison Message (POST) : Requêtes client-vers-serveur

```
Client                             Serveur
  |                                  |
  |---- HTTP GET /events ----------->| (établir connexion SSE)
  |<---- flux d'événement SSE --------| (connexion persistante)
  |                                  |
  |---- HTTP POST /message --------->| (requête client)
  |<---- événement SSE avec réponse ----| (réponse serveur)
  |                                  |
```

### Caractéristiques SSE

- **Accès Distant** : Peut être hébergé sur une machine différente de Kilo Code
- **Scalabilité** : Peut gérer plusieurs connexions client simultanément
- **Protocole** : Fonctionne sur HTTP standard (aucun protocole spécial nécessaire)
- **Persistance** : Maintient une connexion persistante pour les messages serveur-vers-client
- **Authentification** : Peut utiliser les mécanismes d'authentification HTTP standard

### Quand Utiliser SSE

Le transport SSE est meilleur pour :

- L'accès distant à travers les réseaux
- Les scénarios multi-clients
- Les services publics
- Les outils centralisés que beaucoup d'utilisateurs ont besoin d'accéder
- L'intégration avec des services web

### Exemple d'Implémentation SSE

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express from "express"

const app = express()
const server = new Server({ name: "remote-server", version: "1.0.0" })
// Enregistrer les outils...

// Utiliser le transport SSE
const transport = new SSEServerTransport(server)
app.use("/mcp", transport.requestHandler())
app.listen(3000, () => {
	console.log("Serveur MCP à l'écoute sur le port 3000")
})
```

## Local vs Hébergé : Aspects de Déploiement

Le choix entre les transports STDIO et SSE impacte directement comment vous déployerez et gérerez vos serveurs MCP.

### STDIO : Modèle de Déploiement Local

Les serveurs STDIO s'exécutent localement sur la même machine que Kilo Code, ce qui a plusieurs implications importantes :

- **Installation** : L'exécutable serveur doit être installé sur chaque machine utilisateur
- **Distribution** : Vous devez fournir des packages d'installation pour différents systèmes d'exploitation
- **Mises à Jour** : Chaque instance doit être mise à jour séparément
- **Ressources** : Utilise les ressources CPU, mémoire et disque de la machine locale
- **Contrôle d'Accès** : S'appuie sur les permissions du système de fichiers de la machine locale
- **Intégration** : Intégration facile avec les ressources système locales (fichiers, processus)
- **Exécution** : Démarre et s'arrête avec Kilo Code (cycle de vie processus enfant)
- **Dépendances** : Toutes les dépendances doivent être installées sur la machine utilisateur

#### Exemple Pratique

Un outil de recherche de fichier local utilisant STDIOWould :

- S'exécuter sur la machine de l'utilisateur
- Avoir un accès direct au système de fichiers local
- Démarrer quand nécessaire par Kilo Code
- Ne pas nécessiter de configuration réseau
- Avoir besoin d'être installé junto à Kilo Code ou via un gestionnaire de packages

### SSE : Modèle de Déploiement Hébergé

Les serveurs SSE peuvent être déployés sur des serveurs distants et accédés via le réseau :

- **Installation** : Installé une fois sur un serveur, accédé par plusieurs utilisateurs
- **Distribution** : Un seul déploiement sert plusieurs clients
- **Mises à Jour** : Les mises à jour centralisées affectent tous les utilisateurs immédiatement
- **Ressources** : Utilise les ressources serveur, pas les ressources machine locale
- **Contrôle d'Accès** : Géré à travers des systèmes d'authentification et d'autorisation
- **Intégration** : Intégration plus complexe avec les ressources spécifiques à l'utilisateur
- **Exécution** : S'exécute comme un service indépendant (souvent en continu)
- **Dépendances** : Gérées sur le serveur, pas sur les machines utilisateur

#### Exemple Pratique

Un outil de requête de base de données utilisant SSEWould :

- S'exécuter sur un serveur central
- Se connecter aux bases de données avec des identifiants côté serveur
- Être continuellement disponible pour plusieurs utilisateurs
- Nécessiter une configuration de sécurité réseau appropriée
- Être déployé en utilisant des technologies de conteneur ou cloud

### Approches Hybrides

Certains scénarios bénéficient d'une approche hybride :

1. **STDIO avec Accès Réseau** : Un serveur STDIO local qui agit comme un proxy vers des services distants
2. **SSE avec Commandes Locales** : Un serveur SSE distant qui peut déclencher des opérations sur la machine client via des rappels
3. **Motif Passerelle** : Des serveurs STDIO pour les opérations locales qui se connectent à des serveurs SSE pour des fonctions spécialisées

## Choisir Entre STDIO et SSE

| Considération                   | STDIO                         | SSE                                          |
| ------------------------------- | ----------------------------- | -------------------------------------------- |
| **Localisation**                | Machine locale seulement      | Locale ou distante                           |
| **Clients**                     | Client unique                 | Clients multiples                            |
| **Performance**                 | Latence plus faible           | Latence plus élevée (surcharge réseau)       |
| **Complexité de Configuration** | Plus simple                   | Plus complexe (nécessite serveur HTTP)       |
| **Sécurité**                    | Inhérentement sécurisé        | Nécessite des mesures de sécurité explicites |
| **Accès Réseau**                | Pas nécessaire                | Requis                                       |
| **Scalabilité**                 | Limité à la machine locale    | Peut distribuer à travers le réseau          |
| **Déploiement**                 | Installation par utilisateur  | Installation centralisée                     |
| **Mises à Jour**                | Mises à jour distribuées      | Mises à jour centralisées                    |
| **Utilisation de Ressources**   | Utilise les ressources client | Utilise les ressources serveur               |
| **Dépendances**                 | Dépendances côté client       | Dépendances côté serveur                     |

## Configurer les Transports dans Kilo Code

Pour des informations détaillées sur la configuration des transports STDIO et SSE dans Kilo Code, incluant des exemples de configuration, voir la section [Comprendre les Types de Transport](/features/mcp/using-mcp-in-kilo-code#understanding-transport-types) dans le guide Utiliser MCP dans Kilo Code.
