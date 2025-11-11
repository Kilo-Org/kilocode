# codebase_search

:::warning Fonctionnalité expérimentale
L'outil `codebase_search` nécessite une configuration supplémentaire incluant un fournisseur d'embeddings et une base de données vectorielle.
:::

L'outil `codebase_search` effectue des recherches sémantiques sur toute votre base de code en utilisant des embeddings IA. Contrairement à la recherche textuelle traditionnelle, il comprend la signification de vos requêtes et trouve du code pertinent même lorsque les mots-clés exacts ne correspondent pas.

## Paramètres

L'outil accepte ces paramètres :

- `query` (obligatoire) : Requête de recherche en langage naturel décrivant ce que vous cherchez
- `path` (optionnel) : Chemin de répertoire pour limiter la portée de la recherche à une partie spécifique de votre base de code

## Ce qu'il fait

Cet outil recherche dans votre base de code indexée en utilisant la similarité sémantique plutôt que la correspondance de texte exacte. Il trouve des blocs de code conceptuellement liés à votre requête, même s'ils ne contiennent pas les mots exacts que vous avez recherchés. Les résultats incluent des extraits de code pertinents avec des chemins de fichiers, des numéros de ligne et des scores de similarité.

## Quand est-il utilisé ?

- Lorsque Kilo Code a besoin de trouver du code lié à une fonctionnalité spécifique à travers votre projet
- Lors de la recherche de modèles d'implémentation ou de structures de code similaires
- Lors de la recherche de gestion d'erreurs, d'authentification ou d'autres modèles de code conceptuels
- Lors de l'exploration de bases de code inconnues pour comprendre comment les fonctionnalités sont implémentées
- Lors de la recherche de code connexe qui pourrait être affecté par des changements ou du refactoring

## Fonctionnalités clés

- **Compréhension sémantique** : Trouve du code par signification plutôt que par correspondance exacte de mots-clés
- **Recherche inter-projet** : Recherche dans toute votre base de code indexée, pas seulement les fichiers ouverts
- **Résultats contextuels** : Retourne des extraits de code avec des chemins de fichiers et des numéros de ligne pour une navigation facile
- **Scoring de similarité** : Résultats classés par pertinence avec des scores de similarité (échelle 0-1)
- **Filtrage de portée** : Paramètre de chemin optionnel pour limiter les recherches à des répertoires spécifiques
- **Classement intelligent** : Résultats triés par pertinence sémantique par rapport à votre requête
- **Intégration UI** : Résultats affichés avec coloration syntaxique et liens de navigation
- **Optimisé pour les performances** : Recherche vectorielle rapide avec des limites de résultats configurables

## Exigences

Cet outil n'est disponible que lorsque la fonctionnalité expérimentale d'indexation de base de code est correctement configurée :

- **Fonctionnalité activée** : L'indexation de base de code doit être activée dans les paramètres expérimentaux
- **Fournisseur d'embeddings** : Clé API OpenAI ou configuration Ollama requise
- **Base de données vectorielle** : Instance Qdrant en cours d'exécution et accessible
- **Statut d'index** : La base de code doit être indexée (statut : "Indexé" ou "Indexation en cours")

## Limitations

- **Fonctionnalité expérimentale** : Fait partie du système expérimental d'indexation de base de code
- **Nécessite une configuration** : Dépend de services externes (fournisseur d'embeddings + Qdrant)
- **Dépendance à l'index** : Recherche uniquement dans les blocs de code indexés
- **Limites de résultats** : Maximum de 50 résultats par recherche pour maintenir les performances
- **Seuil de similarité** : Retourne uniquement les résultats au-dessus d'un score de similarité de 0,4
- **Limites de taille de fichier** : Limité aux fichiers de moins de 1MB qui ont été correctement indexés
- **Support linguistique** : L'efficacité dépend du support linguistique Tree-sitter

## Fonctionnement

Lorsque l'outil `codebase_search` est invoqué, il suit ce processus :

1. **Validation de disponibilité** :

    - Vérifie que le CodeIndexManager est disponible et initialisé
    - Confirme que l'indexation de base de code est activée dans les paramètres
    - Vérifie que l'indexation est correctement configurée (clés API, URL Qdrant)
    - Valide que l'état actuel de l'index permet la recherche

2. **Traitement de la requête** :

    - Prend votre requête en langage naturel et génère un vecteur d'embedding
    - Utilise le même fournisseur d'embeddings configuré pour l'indexation (OpenAI ou Ollama)
    - Convertit la signification sémantique de votre requête en représentation mathématique

3. **Exécution de recherche vectorielle** :

    - Recherche dans la base de données vectorielle Qdrant des embeddings de code similaires
    - Utilise la similarité cosinus pour trouver les blocs de code les plus pertinents
    - Applique le seuil de similarité minimum (0,4) pour filtrer les résultats
    - Limite les résultats à 50 correspondances pour des performances optimales

4. **Filtrage de chemin** (si spécifié) :

    - Filtre les résultats pour inclure uniquement les fichiers dans le chemin de répertoire spécifié
    - Utilise la comparaison de chemins normalisée pour un filtrage précis
    - Maintient le classement de pertinence dans la portée filtrée

5. **Traitement et formatage des résultats** :

    - Convertit les chemins de fichiers absolus en chemins relatifs à l'espace de travail
    - Structure les résultats avec des chemins de fichiers, des plages de lignes, des scores de similarité et le contenu du code
    - Formate pour la consommation IA et l'affichage UI avec coloration syntaxique

6. **Format de sortie double** :

    - **Sortie IA** : Format texte structuré avec requête, chemins de fichiers, scores et chunks de code
    - **Sortie UI** : Format JSON avec coloration syntaxique et capacités de navigation

## Bonnes pratiques pour les requêtes de recherche

### Modèles de requête efficaces

**Bon : Conceptuel et spécifique**

```xml
<codebase_search>
<query>authentification utilisateur et validation de mot de passe</query>
</codebase_search>
```

**Bon : Axé sur les fonctionnalités**

```xml
<codebase_search>
<query>configuration du pool de connexions base de données</query>
</codebase_search>
```

**Bon : Orienté problème**

```xml
<codebase_search>
<query>gestion des erreurs pour les requêtes API</query>
</codebase_search>
```

**Moins efficace : Trop générique**

```xml
<codebase_search>
<query>fonction</query>
</codebase_search>
```

### Types de requêtes qui fonctionnent bien

- **Descriptions fonctionnelles** : "traitement du téléchargement de fichiers", "logique de validation d'email"
- **Modèles techniques** : "implémentation du pattern singleton", "utilisation de la méthode factory"
- **Concepts de domaine** : "gestion des profils utilisateur", "workflow de traitement des paiements"
- **Composants d'architecture** : "configuration du middleware", "scripts de migration de base de données"

## Délimitation de répertoire

Utilisez le paramètre optionnel `path` pour concentrer les recherches sur des parties spécifiques de votre base de code :

**Recherche dans les modules API :**

```xml
<codebase_search>
<query>middleware de validation des points de terminaison</query>
<path>src/api</path>
</codebase_search>
```

**Recherche dans les fichiers de test :**

```xml
<codebase_search>
<query>modèles de configuration de données fictives</query>
<path>tests</path>
</codebase_search>
```

**Recherche dans les répertoires de fonctionnalités spécifiques :**

```xml
<codebase_search>
<query>gestion d'état des composants</query>
<path>src/components/auth</path>
</codebase_search>
```

## Interprétation des résultats

### Scores de similarité

- **0,8-1,0** : Correspondances très pertinentes, probablement exactement ce que vous cherchez
- **0,6-0,8** : Bonnes correspondances avec une forte similarité conceptuelle
- **0,4-0,6** : Potentiellement pertinentes mais peuvent nécessiter une révision
- **En dessous de 0,4** : Filtrées comme trop dissimilaires

### Structure des résultats

Chaque résultat de recherche inclut :

- **Chemin de fichier** : Chemin relatif à l'espace de travail vers le fichier contenant la correspondance
- **Score** : Score de similarité indiquant la pertinence (0,4-1,0)
- **Plage de lignes** : Numéros de ligne de début et de fin pour le bloc de code
- **Chunk de code** : Le contenu de code réel qui correspond à votre requête

## Exemples d'utilisation

- Lors de l'implémentation d'une nouvelle fonctionnalité, Kilo Code recherche "middleware d'authentification" pour comprendre les modèles existants avant d'écrire nouveau code.
- Lors du débogage d'un problème, Kilo Code recherche "gestion des erreurs dans les appels API" pour trouver des modèles d'erreurs connexes à travers la base de code.
- Lors du refactoring de code, Kilo Code recherche "modèles de transactions base de données" pour assurer la cohérence à travers toutes les opérations de base de données.
- Lors de l'intégration à une nouvelle base de code, Kilo Code recherche "chargement de configuration" pour comprendre comment l'application s'initialise.

## Exemples d'utilisation

Recherche de code lié à l'authentification à travers tout le projet :

```xml
<codebase_search>
<query>logique de connexion et d'authentification utilisateur</query>
</codebase_search>
```

Recherche de code lié aux bases de données dans un répertoire spécifique :

```xml
<codebase_search>
<query>connexion base de données et exécution de requêtes</query>
<path>src/data</path>
</codebase_search>
```

Recherche de modèles de gestion d'erreurs dans le code API :

```xml
<codebase_search>
<query>réponses d'erreur HTTP et gestion des exceptions</query>
<path>src/api</path>
</codebase_search>
```

Recherche d'utilitaires de test et configurations de données fictives :

```xml
<codebase_search>
<query>configuration de test et création de données fictives</query>
<path>tests</path>
</codebase_search>
```

Recherche de code de configuration et de configuration d'environnement :

```xml
<codebase_search>
<query>variables d'environnement et configuration de l'application</query>
</codebase_search>
```
