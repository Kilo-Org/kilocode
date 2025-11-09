# codebase_search

:::info Configuration Requise
L'outil `codebase_search` fait partie de la fonctionnalité [Indexation de Codebase](/features/codebase-indexing). Il requiert une configuration supplémentaire incluant un fournisseur d'embeddings et une base de données vectorielle.
:::

L'outil `codebase_search` effectue des recherches sémantiques à travers toute votre codebase en utilisant des embeddings IA. Contrairement à la recherche basée sur du texte traditionnel, il comprend la signification de vos requêtes et trouve du code pertinent même quand les mots-clés exacts ne correspondent pas.

---

## Paramètres

L'outil accepte ces paramètres :

- `query` (requis) : Requête de recherche en langage naturel décrivant ce que vous cherchez
- `path` (optionnel) : Chemin de répertoire pour limiter la portée de recherche à une partie spécifique de votre codebase

---

## Ce qu'il fait

Cet outil recherche dans votre codebase indexée en utilisant la similarité sémantique plutôt que la correspondance de texte exacte. Il trouve des blocs de code qui sont conceptuellement liés à votre requête, même s'ils ne contiennent pas les mots exacts que vous avez recherchés. Les résultats incluent des extraits de code pertinents avec les chemins de fichiers, les numéros de ligne, et les scores de similarité.

---

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de trouver du code lié à des fonctionnalités spécifiques à travers votre projet
- Quand on cherche des motifs d'implémentation ou des structures de code similaires
- Quand on recherche la gestion d'erreurs, l'authentification, ou d'autres motifs de code conceptuels
- Quand on explore des codebases inconnus pour comprendre comment les fonctionnalités sont implémentées
- Quand on trouve du code lié qui pourrait être affecté par des changements ou du refactoring

---

## Fonctionnalités Clés

- **Compréhension Sémantique** : Trouve du code par signification plutôt que par correspondances exactes de mots-clés
- **Recherche Cross-Projet** : Recherche à travers votre codebase indexée entière, pas seulement les fichiers ouverts
- **Résultats Contextuels** : Retourne des extraits de code avec chemins de fichiers et numéros de ligne pour une navigation facile
- **Score de Similarité** : Résultats classés par pertinence avec scores de similarité (échelle 0-1)
- **Filtrage de Portée** : Paramètre de chemin optionnel pour limiter les recherches à des répertoires spécifiques
- **Classement Intelligent** : Résultats triés par pertinence sémantique à votre requête
- **Intégration UI** : Résultats affichés avec coloration syntaxique et liens de navigation
- **Optimisé Performance** : Recherche vectorielle rapide avec limites de résultats configurables

---

## Exigences

Cet outil n'est disponible que quand la fonctionnalité d'Indexation de Codebase est correctement configurée :

- **Fonctionnalité Configurée** : L'Indexation de Codebase doit être configurée dans les paramètres
- **Fournisseur d'Embeddings** : Clé API OpenAI ou configuration Ollama requise
- **Base de Données Vectorielle** : Instance Qdrant fonctionnant et accessible
- **Statut d'Index** : La codebase doit être indexée (statut : "Indexed" ou "Indexing")

---

## Limitations

- **Requiert Configuration** : Dépend de services externes (fournisseur d'embeddings + Qdrant)
- **Dépendance d'Index** : Ne recherche que dans les blocs de code indexés
- **Limites de Résultats** : Maximum de 50 résultats par recherche pour maintenir la performance
- **Seuil de Similarité** : Ne retourne que les résultats au-dessus du seuil de similarité (défaut : 0.4, configurable)
- **Limites de Taille de Fichier** : Limité aux fichiers sous 1MB qui ont été indexés avec succès
- **Support de Langage** : L'efficacité dépend du support de langage Tree-sitter

---

## Comment ça fonctionne

Quand l'outil `codebase_search` est invoqué, il suit ce processus :

1. **Validation de Disponibilité** :

    - Vérifie que le CodeIndexManager est disponible et initialisé
    - Confirme que l'indexation de codebase est activée dans les paramètres
    - Vérifie que l'indexation est correctement configurée (clés API, URL Qdrant)
    - Valide que l'état d'index actuel permet la recherche

2. **Traitement de Requête** :

    - Prend votre requête en langage naturel et génère un vecteur d'embedding
    - Utilise le même fournisseur d'embeddings configuré pour l'indexation (OpenAI ou Ollama)
    - Convertit la signification sémantique de votre requête en représentation mathématique

3. **Exécution de Recherche Vectorielle** :

    - Recherche dans la base de données vectorielle Qdrant pour les embeddings de code similaires
    - Utilise la similarité cosinus pour trouver les blocs de code les plus pertinents
    - Applique le seuil de similarité minimum (défaut : 0.4, configurable) pour filtrer les résultats
    - Limite les résultats à 50 correspondances pour une performance optimale

4. **Filtrage de Chemin** (si spécifié) :

    - Filtre les résultats pour inclure seulement les fichiers dans le chemin de répertoire spécifié
    - Utilise la comparaison de chemin normalisée pour un filtrage précis
    - Maintient le classement de pertinence dans la portée filtrée

5. **Traitement et Formatage de Résultats** :

    - Convertit les chemins de fichiers absolus en chemins relatifs à l'espace de travail
    - Structure les résultats avec chemins de fichiers, plages de lignes, scores de similarité, et contenu de code
    - Format pour à la fois la consommation IA et l'affichage UI avec coloration syntaxique

6. **Format de Sortie Double** :
    - **Sortie IA** : Format texte structuré avec requête, chemins de fichiers, scores, et chunks de code
    - **Sortie UI** : Format JSON avec coloration syntaxique et capacités de navigation

---

## Meilleures Pratiques pour Requêtes de Recherche

### Motifs de Requête Efficaces

**Bon : Conceptuel et spécifique**

```xml
<codebase_search>
<query>user authentication and password validation</query>
</codebase_search>
```

**Bon : Axé fonctionnalités**

```xml
<codebase_search>
<query>database connection pool setup</query>
</codebase_search>
```

**Bon : Orienté problème**

```xml
<codebase_search>
<query>error handling for API requests</query>
</codebase_search>
```

**Moins efficace : Trop générique**

```xml
<codebase_search>
<query>function</query>
</codebase_search>
```

### Types de Requêtes Qui Fonctionnent Bien

- **Descriptions Fonctionnelles** : "file upload processing", "email validation logic"
- **Motifs Techniques** : "singleton pattern implementation", "factory method usage"
- **Concepts de Domaine** : "user profile management", "payment processing workflow"
- **Composants d'Architecture** : "middleware configuration", "database migration scripts"

---

## Délimitation de Répertoire

Utilisez le paramètre `path` optionnel pour focaliser les recherches sur des parties spécifiques de votre codebase :

**Rechercher dans les modules API :**

```xml
<codebase_search>
<query>endpoint validation middleware</query>
<path>src/api</path>
</codebase_search>
```

**Rechercher dans les fichiers de test :**

```xml
<codebase_search>
<query>mock data setup patterns</query>
<path>tests</path>
</codebase_search>
```

**Rechercher dans des répertoires de fonctionnalités spécifiques :**

```xml
<codebase_search>
<query>component state management</query>
<path>src/components/auth</path>
</codebase_search>
```

---

## Interprétation des Résultats

### Scores de Similarité

- **0.8-1.0** : Correspondances hautement pertinentes, probablement exactement ce que vous cherchez
- **0.6-0.8** : Bonnes correspondances avec forte similarité conceptuelle
- **0.4-0.6** : Potentiellement pertinent mais peut requérir revue
- **En dessous de 0.4** : Filtré comme trop dissemblable

### Structure de Résultat

Chaque résultat de recherche inclut :

- **Chemin de Fichier** : Chemin relatif à l'espace de travail vers le fichier contenant la correspondance
- **Score** : Score de similarité indiquant la pertinence (0.4-1.0)
- **Plage de Lignes** : Numéros de ligne de début et fin pour le bloc de code
- **Chunk de Code** : Le contenu de code réel qui correspond à votre requête

---

## Exemples d'Utilisation

Rechercher du code lié à l'authentification à travers le projet entier :

```xml
<codebase_search>
<query>user login and authentication logic</query>
</codebase_search>
```

Trouver du code lié à la base de données dans un répertoire spécifique :

```xml
<codebase_search>
<query>database connection and query execution</query>
<path>src/data</path>
</codebase_search>
```

Chercher des motifs de gestion d'erreurs dans le code API :

```xml
<codebase_search>
<query>HTTP error responses and exception handling</query>
<path>src/api</path>
</codebase_search>
```

Rechercher des utilitaires de test et configurations mock :

```xml
<codebase_search>
<query>test setup and mock data creation</query>
<path>tests</path>
</codebase_search>
```

Trouver du code de configuration et d'environnement :

```xml
<codebase_search>
<query>environment variables and application configuration</query>
</codebase_search>
```
