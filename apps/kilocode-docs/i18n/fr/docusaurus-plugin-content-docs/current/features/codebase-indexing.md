import Codicon from '@site/src/components/Codicon';

# Indexation de Base de Code

<YouTubeEmbed
  url="https://www.youtube.com/watch?v=dj59Vi83oDw"
/>

L'Indexation de Base de Code permet la recherche sémantique de code à travers votre projet entier en utilisant les embeddings IA. Au lieu de chercher des correspondances de texte exactes, elle comprend la _signification_ de vos requêtes, aidant Kilo Code à trouver le code pertinent même quand vous ne connaissez pas les noms de fonctions spécifiques ou les emplacements de fichiers.

<img src="/docs/img/codebase-indexing/codebase-indexing.png" alt="Paramètres d'Indexation de Base de Code" width="800" />

## Ce qu'elle Fait

Quand activé, le système d'indexation :

1. **Parse votre code** en utilisant Tree-sitter pour identifier les blocs sémantiques (fonctions, classes, méthodes)
2. **Crée des embeddings** de chaque bloc de code en utilisant les modèles IA
3. **Stocke les vecteurs** dans une base de données Qdrant pour la recherche rapide de similarité
4. **Fournit l'outil [`codebase_search`](/advanced-usage/available-tools/codebase-search)** à Kilo Code pour la découverte intelligente de code

Cela permet des requêtes en langage naturel comme "logique d'authentification utilisateur" ou "gestion de connexion base de données" pour trouver le code pertinent à travers votre projet entier.

## Avantages Clés

- **Recherche Sémantique** : Trouvez le code par signification, pas seulement par mots-clés
- **Compréhension IA Améliorée** : Kilo Code peut mieux comprendre et travailler avec votre base de code
- **Découverte Cross-Projet** : Recherchez à travers tous les fichiers, pas seulement ceux ouverts
- **Reconnaissance de Motifs** : Localisez les implémentations et motifs de code similaires

## Exigences de Configuration

### Fournisseur d'Embeddings

Choisissez une de ces options pour générer les embeddings :

**OpenAI (Recommandé)**

- Requiert une clé API OpenAI
- Supporte tous les modèles d'embeddings OpenAI
- Par défaut : `text-embedding-3-small`
- Traite jusqu'à 100,000 tokens par lot

**Gemini**

- Requiert une clé API Google AI
- Supporte les modèles d'embeddings Gemini incluant `gemini-embedding-001`
- Alternative économique à OpenAI
- Embeddings de haute qualité pour la compréhension de code

**Ollama (Local)**

- Requiert une installation locale Ollama
- Aucun coût API ou dépendance internet
- Supporte n'importe quel modèle d'embeddings compatible Ollama
- Requiert la configuration de l'URL de base Ollama

### Base de Données de Vecteurs

**Qdrant** est requis pour stocker et rechercher les embeddings :

- **Local** : `http://localhost:6333` (recommandé pour les tests)
- **Cloud** : Qdrant Cloud ou instance auto-hébergée
- **Authentification** : Clé API optionnelle pour les déploiements sécurisés

## Configurer Qdrant

### Configuration Locale Rapide

**Utiliser Docker :**

```bash
docker run -p 6333:6333 qdrant/qdrant
```

**Utiliser Docker Compose :**

```yaml
version: "3.8"
services:
    qdrant:
        image: qdrant/qdrant
        ports:
            - "6333:6333"
        volumes:
            - qdrant_storage:/qdrant/storage
volumes:
    qdrant_storage:
```

### Déploiement Production

Pour l'utilisation d'équipe ou production :

- [Qdrant Cloud](https://cloud.qdrant.io/) - Service géré
- Auto-hébergé sur AWS, GCP, ou Azure
- Serveur local avec accès réseau pour le partage d'équipe

## Configuration

1. Ouvrez les paramètres Kilo Code (icône <Codicon name="gear" />)
2. Naviguez vers la section **Indexation de Base de Code**
3. Activez **"Activer l'Indexation de Base de Code"** en utilisant l'interrupteur
4. Configurez votre fournisseur d'embeddings :
    - **OpenAI** : Entrez la clé API et sélectionnez le modèle
    - **Gemini** : Entrez la clé API Google AI et sélectionnez le modèle d'embeddings
    - **Ollama** : Entrez l'URL de base et sélectionnez le modèle
5. Définissez l'URL Qdrant et la clé API optionnelle
6. Configurez **Max Résultats de Recherche** (par défaut : 20, plage : 1-100)
7. Cliquez **Sauvegarder** pour démarrer l'indexation initiale

### Interrupteur Activer/Désactiver

La fonctionnalité d'indexation de base de code inclut un interrupteur pratique qui vous permet de :

- **Activer** : Commencer l'indexation de votre base de code et rendre l'outil de recherche disponible
- **Désactiver** : Arrêter l'indexation, mettre en pause l'observation de fichiers, et désactiver la fonctionnalité de recherche
- **Préserver les Paramètres** : Votre configuration reste sauvegardée quand vous désactivez

Cet interrupteur est utile pour désactiver temporairement l'indexation pendant un travail de développement intensif ou quand vous travaillez avec des bases de code sensibles.

## Comprendre le Statut d'Index

L'interface montre le statut en temps réel avec des indicateurs de couleur :

- **Veille** (Gris) : Ne fonctionne pas, en attente de configuration
- **Indexation** (Jaune) : Traite actuellement les fichiers
- **Indexé** (Vert) : À jour et prêt pour les recherches
- **Erreur** (Rouge) : État d'échec nécessitant attention

## Comment les Fichiers sont Traités

### Parsing Intelligent de Code

- **Intégration Tree-sitter** : Utilise le parsing AST pour identifier les blocs de code sémantiques
- **Support de Langage** : Tous les langages supportés par Tree-sitter
- **Support Markdown** : Support complet pour les fichiers markdown et documentation
- **Fallback** : Découpage ligne-par-ligne pour les types de fichiers non supportés
- **Dimensionnement des Blocs** :
    - Minimum : 100 caractères
    - Maximum : 1,000 caractères
    - Divise intelligemment les grandes fonctions

### Filtrage Automatique de Fichiers

L'indexeur exclut automatiquement :

- Les fichiers binaires et images
- Les gros fichiers (>1MB)
- Les dépôts Git (dossiers `.git`)
- Les dépendances (`node_modules`, `vendor`, etc.)
- Les fichiers correspondant aux motifs `.gitignore` et `.kilocode`

### Mises à Jour Incrémentales

- **Observation de Fichiers** : Surveille l'espace de travail pour les changements
- **Mises à Jour Intelligentes** : Ne retraite que les fichiers modifiés
- **Cache Basé sur Hash** : Évite le retraitement de contenu inchangé
- **Basculement de Branche** : Gère automatiquement les changements de branche Git

## Meilleures Pratiques

### Sélection de Modèle

**Pour OpenAI :**

- **`text-embedding-3-small`** : Meilleur équilibre performance/coût
- **`text-embedding-3-large`** : Précision plus élevée, 5x plus cher
- **`text-embedding-ada-002`** : Modèle hérité, coût plus faible

**Pour Ollama :**

- **`mxbai-embed-large`** : Le plus grand et le modèle d'embeddings de plus haute qualité.
- **`nomic-embed-text`** : Meilleur équilibre performance et qualité d'embeddings.
- **`all-minilm`** : Modèle compact avec qualité plus faible mais performance plus rapide.

### Considérations de Sécurité

- **Clés API** : Stockées de manière sécurisée dans le stockage chiffré de VS Code
- **Vie Privée du Code** : Seuls de petits extraits de code envoyés pour les embeddings (pas les fichiers entiers)
- **Traitement Local** : Tout le parsing se passe localement
- **Sécurité Qdrant** : Utilisez l'authentification pour les déploiements production

## Limites Actuelles

- **Taille de Fichier** : 1MB maximum par fichier
- **Espace de Travail Unique** : Un espace de travail à la fois
- **Dépendances** : Requiert des services externes (fournisseur d'embeddings + Qdrant)
- **Couverture de Langage** : Limité aux langages supportés par Tree-sitter pour un parsing optimal

## Utiliser la Fonctionnalité de Recherche

Une fois indexé, Kilo Code peut utiliser l'outil [`codebase_search`](/advanced-usage/available-tools/codebase-search) pour trouver le code pertinent :

**Exemples de Requêtes :**

- "Comment l'authentification utilisateur est-elle gérée ?"
- "Configuration de connexion base de données"
- "Motifs de gestion d'erreurs"
- "Définitions de points de terminaison API"

L'outil fournit à Kilo Code :

- Des extraits de code pertinents (jusqu'à votre limite de max résultats configurée)
- Les chemins de fichiers et numéros de ligne
- Les scores de similarité
- Les informations contextuelles

### Configuration des Résultats de Recherche

Vous pouvez contrôler le nombre de résultats de recherche retournés en ajustant le paramètre **Max Résultats de Recherche** :

- **Par Défaut** : 20 résultats
- **Plage** : 1-100 résultats
- **Performance** : Les valeurs plus faibles améliorent la vitesse de réponse
- **Exhaustivité** : Les valeurs plus élevées fournissent plus de contexte mais peuvent ralentir les réponses

## Vie Privée et Sécurité

- **Le code reste local** : Seuls de petits extraits de code envoyés pour les embeddings
- **Les embeddings sont numériques** : Représentations non lisibles par l'homme
- **Stockage sécurisé** : Clés API chiffrées dans le stockage VS Code
- **Option locale** : Utilisez Ollama pour un traitement complètement local
- **Contrôle d'accès** : Respecte les permissions de fichiers existantes

## Améliorations Futures

Améliorations planifiées :

- Fournisseurs d'embeddings additionnels
- Indexation multi-espaces de travail
- Options de filtrage et configuration améliorées
- Capacités de partage d'équipe
- Intégration avec la recherche native de VS Code
