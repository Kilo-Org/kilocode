# access_mcp_resource

L'outil `access_mcp_resource` récupère les données depuis les ressources exposées par les serveurs Model Context Protocol (MCP) connectés. Il permet à Kilo Code d'accéder aux fichiers, réponses API, documentation, ou informations système qui fournissent un contexte additionnel pour les tâches.

## Paramètres

L'outil accepte ces paramètres :

- `server_name` (requis) : Le nom du serveur MCP fournissant la ressource
- `uri` (requis) : L'URI identifiant la ressource spécifique à accéder

## Ce qu'il fait

Cet outil se connecte aux serveurs MCP et récupère les données de leurs ressources exposées. Contrairement à `use_mcp_tool` qui exécute des actions, cet outil récupère spécifiquement des informations qui servent de contexte pour les tâches.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de contexte additionnel depuis des systèmes externes
- Quand Kilo Code a besoin d'accéder à des données spécifiques au domaine depuis des serveurs MCP spécialisés
- Quand Kilo Code a besoin de récupérer de la documentation de référence hébergée par les serveurs MCP
- Quand Kilo Code a besoin d'intégrer des données temps réel depuis des APIs externes via MCP

## Caractéristiques Clés

- Récupère les données texte et image depuis les ressources MCP
- Nécessite l'approbation utilisateur avant d'exécuter l'accès aux ressources
- Utilise l'adressage basé sur URI pour identifier précisément les ressources
- S'intègre avec le SDK Model Context Protocol
- Affiche le contenu des ressources de manière appropriée selon le type de contenu
- Supporte les timeouts pour des opérations réseau fiables
- Gère les états de connexion serveur (connecté, en cours de connexion, déconnecté)
- Découvre les ressources disponibles depuis les serveurs connectés
- Traite les données de réponse structurées avec métadonnées
- Gère le rendu spécial du contenu image

## Limitations

- Dépend des serveurs MCP externes qui sont disponibles et connectés
- Limité aux ressources fournies par les serveurs connectés
- Ne peut pas accéder aux ressources depuis les serveurs désactivés
- Les problèmes réseau peuvent affecter la fiabilité et la performance
- L'accès aux ressources est sujet aux timeouts configurés
- Les formats d'URI sont déterminés par l'implémentation du serveur MCP spécifique
- Pas de capacités d'accès aux ressources hors ligne ou en cache

## Comment ça fonctionne

Quand l'outil `access_mcp_resource` est invoqué, il suit ce processus :

1. **Validation de Connexion** :

    - Vérifie qu'un hub MCP est disponible et initialisé
    - Confirme que le serveur spécifié existe dans la liste de connexion
    - Vérifie si le serveur est désactivé (retourne une erreur s'il l'est)

2. **Approbation Utilisateur** :

    - Présente la requête d'accès à la ressource à l'utilisateur pour approbation
    - Fournit le nom serveur et l'URI de ressource pour vérification utilisateur
    - Procède seulement si l'utilisateur approuve l'accès à la ressource

3. **Requête de Ressource** :

    - Utilise le SDK Model Context Protocol pour communiquer avec les serveurs
    - Fait une requête `resources/read` au serveur à travers le hub MCP
    - Applique les timeouts configurés pour empêcher l'accrochage sur les serveurs non responsifs

4. **Traitement de Réponse** :
    - Reçoit une réponse structurée avec métadonnées et tableaux de contenu
    - Traite le contenu texte pour affichage à l'utilisateur
    - Gère les données image spécialement pour affichage approprié
    - Retourne les données de ressource traitées à Kilo Code pour utilisation dans la tâche actuelle

## Types de Ressources

Les serveurs MCP peuvent fournir deux types principaux de ressources :

1. **Ressources Standard** :

    - Ressources fixes avec URIs spécifiques
    - Nom, description et type MIME définis
    - Accès direct sans paramètres
    - Représentent typiquement des données statiques ou information temps réel

2. **Modèles de Ressource** :
    - Ressources paramétrisées avec valeurs de placeholder dans les URIs
    - Permettent la génération dynamique de ressources basées sur les paramètres fournis
    - Peuvent représenter des requêtes ou vues filtrées de données
    - Plus flexibles mais nécessitent un formatage URI additionnel

## Exemples d'Utilisation

- En aidant avec le développement API, Kilo Code récupère les spécifications de points de terminaison depuis les ressources MCP pour assurer l'implémentation correcte.
- En assistant avec la visualisation de données, Kilo Code accède aux échantillons de données actuelles depuis les serveurs MCP connectés.
- En travaillant dans des domaines spécialisés, Kilo Code récupère la documentation technique pour fournir une guidance précise.
- En générant du code spécifique à l'industrie, Kilo Code référence les exigences de conformité depuis les ressources de documentation.

## Exemples d'Usage

Accéder aux données météo actuelles :

```
<access_mcp_resource>
<server_name>weather-server</server_name>
<uri>weather://san-francisco/current</uri>
</access_mcp_resource>
```

Récupérer de la documentation API :

```
<access_mcp_resource>
<server_name>api-docs</server_name>
<uri>docs://payment-service/endpoints</uri>
</access_mcp_resource>
```

Accéder à la connaissance spécifique au domaine :

```
<access_mcp_resource>
<server_name>knowledge-base</server_name>
<uri>kb://medical/terminology/common</uri>
</access_mcp_resource>
```

Récupérer la configuration système :

```
<access_mcp_resource>
<server_name>infra-monitor</server_name>
<uri>config://production/database</uri>
</access_mcp_resource>
```
