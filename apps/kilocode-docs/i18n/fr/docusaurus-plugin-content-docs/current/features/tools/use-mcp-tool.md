# use_mcp_tool

L'outil `use_mcp_tool` permet l'interaction avec des outils externes fournis par les serveurs Model Context Protocol (MCP) connectés. Il étend les capacités de Kilo Code avec des fonctionnalités spécifiques au domaine à travers un protocole standardisé.

## Paramètres

L'outil accepte ces paramètres :

- `server_name` (requis) : Le nom du serveur MCP fournissant l'outil
- `tool_name` (requis) : Le nom de l'outil à exécuter
- `arguments` (requis/optionnel) : Un objet JSON contenant les paramètres d'entrée de l'outil, suivant le schéma d'entrée de l'outil. Peut être optionnel pour les outils qui ne requièrent pas d'entrée.

## Ce qu'il fait

Cet outil permet à Kilo Code d'accéder à des fonctionnalités spécialisées fournies par des serveurs MCP externes. Chaque serveur MCP peut offrir plusieurs outils avec des capacités uniques, étendant Kilo Code au-delà de ses fonctionnalités intégrées. Le système valide les arguments contre les schémas, gère les connexions serveur, et traite les réponses de divers types de contenu (texte, image, ressource).

## Quand est-il utilisé ?

- Quand des fonctionnalités spécialisées non disponibles dans les outils de base sont nécessaires
- Quand des opérations spécifiques au domaine sont requises
- Quand l'intégration avec des systèmes ou services externes est nécessaire
- Quand on travaille avec des données qui requièrent un traitement ou une analyse spécifique
- Quand on accède à des outils propriétaires à travers une interface standardisée

## Fonctionnalités Clés

- Utilise le protocole MCP standardisé via la bibliothèque `@modelcontextprotocol/sdk`
- Supporte plusieurs mécanismes de transport (StdioClientTransport et SSEClientTransport)
- Valide les arguments en utilisant la validation de schéma Zod à la fois côté client et serveur
- Traite plusieurs types de contenu de réponse : texte, image, et références de ressource
- Gère le cycle de vie des serveur avec des redémarrages automatiques quand le code serveur change
- Fournit un mécanisme "toujours autoriser" pour contourner l'approbation pour les outils de confiance
- Fonctionne avec l'outil compagnon `access_mcp_resource` pour la récupération de ressource
- Maintient un suivi et une gestion d'erreurs appropriés pour les opérations échouées
- Supporte les timeouts configurables (1-3600 secondes, défaut : 60 secondes)
- Permet aux watchers de fichier de détecter automatiquement et recharger les changements serveur

## Limitations

- Dépend des serveurs MCP externes étant disponibles et connectés
- Limité aux outils fournis par les serveurs connectés
- Les capacités d'outil varient entre les différents serveurs MCP
- Les problèmes réseau peuvent affecter la fiabilité et la performance
- Requiert l'approbation de l'utilisateur avant l'exécution (sauf dans la liste "toujours autoriser")
- Ne peut pas exécuter plusieurs opérations d'outil MCP simultanément

## Configuration Serveur

Les serveurs MCP peuvent être configurés globalement ou au niveau du projet :

- **Configuration Globale** : Gérée à travers les paramètres de l'extension Kilo Code dans VS Code. Celies s'appliquent à travers tous les projets sauf si surchargées.
- **Configuration au Niveau Projet** : Définie dans un fichier `.kilocode/mcp.json` dans le répertoire racine de votre projet.
- Ceci permet des configurations serveur spécifiques au projet.
- Les serveurs au niveau projet prennent la priorité sur les serveurs globaux s'ils partagent le même nom.
- Comme `.kilocode/mcp.json` peut être commité au contrôle de version, cela simplifie le partage de configurations avec votre équipe.

## Comment ça fonctionne

Quand l'outil `use_mcp_tool` est invoqué, il suit ce processus :

1. **Initialisation et Validation** :

    - Le système vérifie que le hub MCP est disponible
    - Confirme que le serveur spécifié existe et est connecté
    - Valide que l'outil demandé existe sur le serveur
    - Les arguments sont validés contre la définition de schéma de l'outil
    - Les paramètres de timeout sont extraits de la configuration serveur (défaut : 60 secondes)

2. **Exécution et Communication** :

    - Le système sélectionne le mécanisme de transport approprié :
        - `StdioClientTransport` : Pour communiquer avec les processus locaux via E/S standard
        - `SSEClientTransport` : Pour communiquer avec les serveurs HTTP via Server-Sent Events
    - Une requête est envoyée avec le nom de serveur validé, nom d'outil, et arguments
    - La communication utilise la bibliothèque `@modelcontextprotocol/sdk` pour des interactions standardisées
    - L'exécution de requête est suivie avec gestion de timeout pour prévenir les opérations suspendues

3. **Traitement de Réponse** :

    - Les réponses peuvent inclure plusieurs types de contenu :
        - Contenu texte : Réponses en texte simple
        - Contenu image : Données d'image binaire avec informations de type MIME
        - Références ressource : URIs pour accéder aux ressources serveur (fonctionne avec `access_mcp_resource`)
    - Le système vérifie le drapeaux `isError` pour déterminer si la gestion d'erreur est nécessaire
    - Les résultats sont formatés pour l'affichage dans l'interface Kilo Code

4. **Gestion de Ressource et d'Erreur** :
    - Le système utilise des motifs WeakRef pour prévenir les fuites de mémoire
    - Un compteur d'erreurs consécutives suit et gère les erreurs
    - Les watchers de fichier surveillent les changements de code serveur et déclenchent des redémarrages automatiques
    - Le modèle de sécurité requiert l'approbation pour l'exécution d'outil sauf dans la liste "toujours autoriser"

## Sécurité et Permissions

L'architecture MCP fournit plusieurs fonctionnalités de sécurité :

- Les utilisateurs doivent approuver l'utilisation d'outil avant l'exécution (par défaut)
- Des outils spécifiques peuvent être marqués pour l'approbation automatique dans la liste "toujours autoriser"
- Les configurations serveur sont validées avec des schémas Zod pour l'intégrité
- Les timeouts configurables préviennent les opérations suspendues (1-3600 secondes)
- Les connexions serveur peuvent être activées ou désactivées à travers l'UI

## Exemples d'Utilisation

- Analyser des formats de données spécialisés en utilisant des outils de traitement côté serveur
- Générer des images ou autres médias à travers des modèles IA hébergés sur des serveurs externes
- Exécuter des calculs complexes spécifiques au domaine sans implémentation locale
- Accéder à des APIs ou services propriétaires à travers une interface contrôlée
- Récupérer des données depuis des bases de données ou sources de données spécialisées

## Exemples d'Usage

Demander des données de prévision météo avec réponse texte :

```
<use_mcp_tool>
<server_name>weather-server</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5,
  "format": "text"
}
</arguments>
</use_mcp_tool>
```

Analyser du code source avec un outil spécialisé qui retourne JSON :

```
<use_mcp_tool>
<server_name>code-analysis</server_name>
<tool_name>complexity_metrics</tool_name>
<arguments>
{
  "language": "typescript",
  "file_path": "src/app.ts",
  "include_functions": true,
  "metrics": ["cyclomatic", "cognitive"]
}
</arguments>
</use_mcp_tool>
```

Générer une image avec des paramètres spécifiques :

```
<use_mcp_tool>
<server_name>image-generation</server_name>
<tool_name>create_image</tool_name>
<arguments>
{
  "prompt": "Une ville futuriste avec des voitures volantes",
  "style": "photorealistic",
  "dimensions": {
    "width": 1024,
    "height": 768
  },
  "format": "webp"
}
</arguments>
</use_mcp_tool>
```

Accéder à une ressource à travers un outil qui retourne une référence ressource :

```
<use_mcp_tool>
<server_name>database-connector</server_name>
<tool_name>query_and_store</tool_name>
<arguments>
{
  "database": "users",
  "type": "select",
  "fields": ["name", "email", "last_login"],
  "where": {
    "status": "active"
  },
  "store_as": "active_users"
}
</arguments>
</use_mcp_tool>
```

Outil sans arguments requis :

```
<use_mcp_tool>
<server_name>system-monitor</server_name>
<tool_name>get_current_status</tool_name>
<arguments>
{}
</arguments>
</use_mcp_tool>
```
