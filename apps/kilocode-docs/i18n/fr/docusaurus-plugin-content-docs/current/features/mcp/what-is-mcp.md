---
title: Qu'est-ce que MCP ?
sidebar_label: Qu'est-ce que MCP ?
---

# Qu'est-ce que MCP ?

MCP (Protocole de Contexte Modèle) est un protocole de communication standardisé pour les systèmes LLM afin d'interagir avec des outils et services externes. Il fonctionne comme un adaptateur universel entre les assistants IA et diverses sources de données ou applications.

## Comment ça Fonctionne

MCP utilise une architecture client-serveur :

1. L'assistant IA (client) se connecte aux serveurs MCP
2. Chaque serveur fournit des capacités spécifiques (accès fichiers, requêtes base de données, intégrations API)
3. L'IA utilise ces capacités à travers une interface standardisée
4. La communication se fait via des messages JSON-RPC 2.0

Pensez à MCP comme similaire à un port USB-C en ce sens que n'importe quel LLM compatible peut se connecter à n'importe quel serveur MCP pour accéder à sa fonctionnalité. Cette standardisation élimine le besoin de construire des intégrations personnalisées pour chaque outil et service.

Par exemple, une IA utilisant MCP peut effectuer des tâches comme "rechercher dans notre base de données d'entreprise et générer un rapport" sans nécessiter de code spécialisé pour chaque système de base de données.

## Questions Communes

- **MCP est-il un service cloud ?** Les serveurs MCP peuvent s'exécuter localement sur votre ordinateur ou à distance comme services cloud, selon le cas d'usage et les exigences de sécurité.

- **MCP remplace-t-il d'autres méthodes d'intégration ?** Non. MCP complète les outils existants comme les plugins API et la génération augmentée par récupération. Il fournit un protocole standardisé pour l'interaction avec les outils mais ne remplace pas les approches d'intégration spécialisées.

- **Comment la sécurité est-elle gérée ?** Les utilisateurs contrôlent à quels serveurs MCP ils se connectent et quelles permissions ces serveurs ont. Comme avec tout outil qui accède à des données ou services, utilisez des sources de confiance et configurez des contrôles d'accès appropriés.

## MCP dans Kilo Code

Kilo Code implémente le Protocole de Contexte Modèle pour :

- Se connecter aux serveurs MCP locaux et distants
- Fournir une interface consistante pour accéder aux outils
- Étendre la fonctionnalité sans modifications du noyau
- Activer les capacités spécialisées à la demande

MCP fournit une manière standardisée pour les systèmes IA d'interagir avec des outils et services externes, rendant les intégrations complexes plus accessibles et consistantes.

## En Savoir Plus sur MCP

Prêt à creuser plus profond ? Consultez ces guides :

- [Vue d'Ensemble MCP](/features/mcp/overview) - Un regard rapide sur la structure de documentation MCP
- [Utiliser MCP dans Kilo Code](/features/mcp/using-mcp-in-kilo-code) - Commencez avec MCP dans Kilo Code, incluant la création de serveurs simples
- [MCP vs API](/features/mcp/mcp-vs-api) - Avantages techniques comparés aux APIs traditionnelles
- [Transports STDIO & SSE](/features/mcp/server-transports) - Modèles de déploiement local vs hébergé
