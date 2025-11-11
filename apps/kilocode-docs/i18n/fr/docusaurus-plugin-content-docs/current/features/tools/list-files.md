# list_files

L'outil `list_files` affiche les fichiers et répertoires dans un emplacement spécifié. Il aide Kilo Code à comprendre la structure de votre projet et naviguer votre codebase efficacement.

## Paramètres

L'outil accepte ces paramètres :

- `path` (requis) : Le chemin du répertoire pour lister le contenu, relatif au répertoire de travail actuel
- `recursive` (optionnel) : Si lister les fichiers de manière récursive. Utilisez `true` pour lister de manière récursive, `false` ou omettez pour le niveau supérieur seulement.

## Ce qu'il fait

Cet outil liste tous les fichiers et répertoires dans un emplacement spécifié, fournissant une vue d'ensemble claire de la structure de votre projet. Il peut soit montrer seulement le contenu de niveau supérieur, soit explorer récursivement les sous-répertoires.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de comprendre la structure de votre projet
- Quand Kilo Code explore quels fichiers sont disponibles avant de lire des fichiers spécifiques
- Quand Kilo Code cartographie une codebase pour mieux comprendre son organisation
- Avant d'utiliser des outils plus ciblés comme `read_file` ou `search_files`
- Quand Kilo Code a besoin de vérifier des types de fichiers spécifiques (comme les fichiers de configuration) à travers un projet

## Fonctionnalités Clés

- Liste à la fois les fichiers et répertoires avec répertoires clairement marqués
- Offre à la fois les modes de listage récursif et non-récursif
- Ignore intelligemment les répertoires communs volumineux comme `node_modules` et `.git` en mode récursif
- Respecte les règles `.gitignore` quand en mode récursif
- Marque les fichiers ignorés par `.kilocodeignore` avec un symbole de verrouillage (🔒) quand `showKiloCodeIgnoredFiles` est activé
- Optimise la performance avec la traversée de répertoire niveau par niveau
- Trie les résultats pour montrer les répertoires avant leur contenu, maintenant une hiérarchie logique
- Présente les résultats dans un format propre et organisé
- Crée automatiquement une carte mentale de la structure de votre projet

## Limitations

- Le listage de fichier est plafonné à environ 200 fichiers par défaut pour prévenir les problèmes de performance
- A un timeout de 10 secondes pour la traversée de répertoire pour prévenir la suspension sur des structures de répertoire complexes
- Quand la limite de fichier est atteinte, il ajoute une note suggérant d'utiliser `list_files` sur des sous-répertoires spécifiques
- N'est pas conçu pour confirmer l'existence de fichiers que vous venez de créer
- Peut avoir une performance réduite dans des structures de répertoire très volumineuses
- Ne peut pas lister les fichiers dans les répertoires root ou home pour des raisons de sécurité

## Comment ça fonctionne

Quand l'outil `list_files` est invoqué, il suit ce processus :

1. **Validation de Paramètre** : Valide le paramètre `path` requis et le paramètre `recursive` optionnel
2. **Résolution de Chemin** : Résout le chemin relatif vers un chemin absolu
3. **Contrôles de Sécurité** : Empêche le listage de fichiers dans des emplacements sensibles comme les répertoires root ou home
4. **Scan de Répertoire** :
    - Pour le mode non-récursif : Liste seulement le contenu de niveau supérieur
    - Pour le mode récursif : Traverse la structure de répertoire niveau par niveau avec un timeout de 10 secondes
    - Si timeout se produit, retourne des résultats partiels collectés jusqu'à ce point
5. **Filtrage de Résultats** :
    - En mode récursif, ignore les répertoires communs volumineux comme `node_modules`, `.git`, etc.
    - Respecte les règles `.gitignore` quand en mode récursif
    - Gère les motifs `.kilocodeignore`, soit en cachant les fichiers soit en les marquant avec un symbole de verrouillage
6. **Formatage** :
    - Marque les répertoires avec un slash de fin (`/`)
    - Trie les résultats pour montrer les répertoires avant leur contenu pour une hiérarchie logique
    - Marque les fichiers ignorés avec un symbole de verrouillage (🔒) quand `showKiloCodeIgnored` est activé
    - Plafonne les résultats à 200 fichiers par défaut avec une note sur l'utilisation de sous-répertoires
    - Organise les résultats pour la lisibilité

## Format de Listage de Fichier

Les résultats de listage de fichier incluent :

- Chaque chemin de fichier est affiché sur sa propre ligne
- Les répertoires sont marqués avec un slash de fin (`/`)
- Les fichiers ignorés par `.kilocodeignore` sont marqués avec un symbole de verrouillage (🔒) quand `showKiloCodeIgnored` est activé
- Les résultats sont triés logiquement avec les répertoires apparaissant avant leur contenu
- Quand la limite de fichier est atteinte, un message apparaît suggérant d'utiliser `list_files` sur des sous-répertoires spécifiques

Exemple de format de sortie :

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
src/utils/
src/utils/helpers.ts
src/index.ts
...
File listing truncated (showing 200 of 543 files). Use list_files on specific subdirectories for more details.
```

Quand des fichiers `.kilocodeignore` sont utilisés et `showKiloCodeIgnored` est activé :

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
🔒 src/secrets.json
src/utils/
src/utils/helpers.ts
src/index.ts
```

## Exemples d'Utilisation

- Quand on commence une nouvelle tâche, Kilo Code peut lister les fichiers du projet pour comprendre sa structure avant d'entrer dans du code spécifique.
- Quand on demande de trouver des types de fichiers spécifiques (comme tous les fichiers JavaScript), Kilo Code liste d'abord les répertoires pour savoir où regarder.
- Quand on fournit des recommandations pour l'organisation de code, Kilo Code examine d'abord la structure de projet actuelle.
- Quand on configure une nouvelle fonctionnalité, Kilo Code liste les répertoires liés pour comprendre les conventions du projet.

## Exemples d'Usage

Lister les fichiers de niveau supérieur dans le répertoire actuel :

```
<list_files>
<path>.</path>
</list_files>
```

Lister de manière récursive tous les fichiers dans un répertoire source :

```
<list_files>
<path>src</path>
<recursive>true</recursive>
</list_files>
```

Examiner un sous-répertoire de projet spécifique :

```
<list_files>
<path>src/components</path>
<recursive>false</recursive>
</list_files>
```
