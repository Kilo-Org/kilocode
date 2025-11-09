# list_code_definition_names

L'outil `list_code_definition_names` fournit une vue d'ensemble structurale de votre codebase en listant les définitions de code depuis les fichiers source au niveau supérieur d'un répertoire spécifié. Il aide Kilo Code à comprendre l'architecture de code en affichant les numéros de ligne et les extraits de définition.

## Paramètres

L'outil accepte ces paramètres :

- `path` (requis) : Le chemin du répertoire pour lister les définitions de code source de niveau supérieur, relatif au répertoire de travail actuel

## Ce qu'il fait

Cet outil scanne les fichiers de code source au niveau supérieur d'un répertoire spécifié et extrait les définitions de code comme les classes, fonctions, et interfaces. Il affiche les numéros de ligne et le code réel pour chaque définition, fournissant un moyen rapide de cartographier les composants importants de votre codebase.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de comprendre rapidement l'architecture de votre codebase
- Quand Kilo Code a besoin de localiser des constructions de code importantes à travers plusieurs fichiers
- Quand on planifie du refactoring ou des extensions à du code existant
- Avant d'entrer dans les détails d'implémentation avec d'autres outils
- Quand on identifie les relations entre différentes parties de votre codebase

## Fonctionnalités Clés

- Extrait les classes, fonctions, méthodes, interfaces, et autres définitions des fichiers source
- Affiche les numéros de ligne et le code source réel pour chaque définition
- Supporte plusieurs langages de programmation incluant JavaScript, TypeScript, Python, Rust, Go, C++, C, C#, Ruby, Java, PHP, Swift, et Kotlin
- Traite seulement les fichiers au niveau supérieur du répertoire spécifié (pas les sous-répertoires)
- Limite le traitement à un maximum de 50 fichiers pour la performance
- Se concentre sur les définitions de niveau supérieur pour éviter les détails écrasants
- Aide à identifier les motifs d'organisation de code à travers le projet
- Crée une carte mentale de l'architecture de votre codebase
- Fonctionne en conjonction avec d'autres outils comme `read_file` pour une analyse plus profonde

## Limitations

- Identifie seulement les définitions de niveau supérieur, pas celles imbriquées
- Traite seulement les fichiers au niveau supérieur du répertoire spécifié, pas les sous-répertoires
- Limité au traitement d'un maximum de 50 fichiers par requête
- Dépend des analyseurs spécifiques au langage, avec une qualité de détection variable
- Peut ne pas reconnaître toutes les définitions dans les langages avec une syntaxe complexe
- N'est pas un substitut pour lire le code pour comprendre les détails d'implémentation
- Ne peut pas détecter les motifs d'exécution ou les relations de code dynamiques
- Ne fournit pas d'informations sur comment les définitions sont utilisées
- Peut avoir une précision réduite avec du code hautement dynamique ou métaprogrammé
- Limité aux langages spécifiques supportés par les analyseurs Tree-sitter implémentés

## Comment ça fonctionne

Quand l'outil `list_code_definition_names` est invoqué, il suit ce processus :

1. **Validation de Paramètre** : Valide le paramètre `path` requis
2. **Résolution de Chemin** : Résout le chemin relatif vers un chemin absolu
3. **Scan de Répertoire** : Scanne seulement le niveau supérieur du répertoire spécifié pour les fichiers de code source (pas récursif)
4. **Filtrage de Fichier** : Limite le traitement à un maximum de 50 fichiers
5. **Détection de Langage** : Identifie les types de fichiers basés sur les extensions (.js, .jsx, .ts, .tsx, .py, .rs, .go, .cpp, .hpp, .c, .h, .cs, .rb, .java, .php, .swift, .kt, .kts)
6. **Analyse de Code** : Utilise Tree-sitter pour analyser le code et extraire les définitions à travers ces étapes :
    - Analyse le contenu de fichier dans un Arbre de Syntaxe Abstrait (AST)
    - Crée une requête en utilisant une chaîne de requête spécifique au langage
    - Trie les captures par leur position dans le fichier
7. **Formatage de Sortie** : Affiche les définitions avec numéros de ligne et code source réel

## Format de Sortie

La sortie montre les chemins de fichiers suivis par les numéros de ligne et le code source réel de chaque définition. Par exemple :

```
src/utils.js:
0--0 | export class HttpClient {
5--5 | formatDate() {
10--10 | function parseConfig(data) {

src/models/User.js:
0--0 | interface UserProfile {
10--10 | export class User {
20--20 | function createUser(data) {
```

Chaque ligne affiche :

- Les numéros de ligne de début et fin de la définition
- Le symbole pipe (|) comme séparateur
- Le code source réel de la définition

Ce format de sortie vous aide à voir rapidement à la fois où les définitions sont located dans le fichier et leurs détails d'implémentation.

## Exemples d'Utilisation

- Quand on commence une nouvelle tâche, Kilo Code liste d'abord les définitions de code clés pour comprendre la structure générale de votre projet.
- Quand on planifie du travail de refactoring, Kilo Code utilise cet outil pour identifier les classes et fonctions qui pourraient être affectées.
- Quand on explore des codebases inconnus, Kilo Code cartographie les constructions de code importantes avant d'entrer dans les détails d'implémentation.
- Quand on ajoute de nouvelles fonctionnalités, Kilo Code identifie les motifs existants et les définitions de code pertinentes pour maintenir la cohérence.
- Quand on débogue des bogues, Kilo Code cartographie la structure de codebase pour localiser les sources potentielles du problème.
- Quand on planifie des changements d'architecture, Kilo Code identifie tous les composants affectés à travers les fichiers.

## Exemples d'Usage

Lister les définitions de code dans le répertoire actuel :

```
<list_code_definition_names>
<path>.</path>
</list_code_definition_names>
```

Examiner la structure d'un module spécifique :

```
<list_code_definition_names>
<path>src/components</path>
</list_code_definition_names>
```

Explorer une bibliothèque utilitaire :

```
<list_code_definition_names>
<path>lib/utils</path>
</list_code_definition_names>
```
