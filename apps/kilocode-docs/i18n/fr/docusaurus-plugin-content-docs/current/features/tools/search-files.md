# search_files

L'outil `search_files` effectue des recherches regex à travers plusieurs fichiers dans votre projet. Il aide Kilo Code à localiser des motifs de code spécifiques, du texte, ou autre contenu à travers votre base de code avec des résultats contextuels.

## Paramètres

L'outil accepte ces paramètres :

- `path` (requis) : Le chemin du répertoire dans lequel chercher, relatif au répertoire de travail actuel
- `regex` (requis) : Le motif d'expression régulière à chercher (utilise la syntaxe regex Rust)
- `file_pattern` (optionnel) : Motif glob pour filtrer les fichiers (par ex., '\*.ts' pour les fichiers TypeScript)

## Ce qu'il fait

Cet outil recherche à travers les fichiers dans un répertoire spécifié en utilisant des expressions régulières, montrant chaque correspondance avec le contexte environnant. C'est comme avoir une fonctionnalité puissante "Trouver dans les Fichiers" qui fonctionne à travers toute la structure de projet.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de trouver où des fonctions ou variables spécifiques sont utilisées
- Quand Kilo Code aide avec la refactorisation et a besoin de comprendre les motifs d'utilisation
- Quand Kilo Code a besoin de localiser toutes les instances d'un motif de code particulier
- Quand Kilo Code recherche du texte à travers plusieurs fichiers avec des capacités de filtrage

## Caractéristiques Clés

- Recherche à travers plusieurs fichiers en une seule opération en utilisant Ripgrep haute performance
- Montre le contexte autour de chaque correspondance (1 ligne avant et après)
- Filtre les fichiers par type en utilisant des motifs glob (par ex., seulement les fichiers TypeScript)
- Fournit des numéros de ligne pour référence facile
- Utilise des motifs regex puissants pour des recherches précises
- Limite automatiquement la sortie à 300 résultats avec notification
- Tronque les lignes plus longues que 500 caractères avec marqueur "[truncated...]"
- Intelligemment combine les correspondances proches en blocs uniques pour lisibilité

## Limitations

- Fonctionne mieux avec les fichiers texte (pas efficace pour les fichiers binaires comme les images)
- La performance peut ralentir avec des extrêmement grosses bases de code
- Utilise la syntaxe regex Rust, qui peut différer légèrement des autres implémentations regex
- Ne peut pas chercher dans les fichiers compressés ou archives
- La taille de contexte par défaut est fixe (1 ligne avant et après)
- Peut afficher des tailles de contexte variables quand les correspondances sont proches ensemble à cause du regroupement de résultats

## Comment ça fonctionne

Quand l'outil `search_files` est invoqué, il suit ce processus :

1. **Validation de Paramètres** : Valide les paramètres `path` et `regex` requis
2. **Résolution de Chemin** : Résout le chemin relatif vers un chemin absolu
3. **Exécution de Recherche** :
    - Utilise Ripgrep (rg) pour la recherche de texte haute performance
    - Applique le filtrage de motif de fichier si spécifié
    - Collecte les correspondances avec contexte environnant
4. **Formatage de Résultats** :
    - Formate les résultats avec chemins de fichiers, numéros de ligne, et contexte
    - Affiche 1 ligne de contexte avant et après chaque correspondance
    - Structure la sortie pour lisibilité facile
    - Limite les résultats à un maximum de 300 correspondances avec notification
    - Tronque les lignes plus longues que 500 caractères
    - Fusionne les correspondances proches en blocs contigus

## Format des Résultats de Recherche

Les résultats de recherche incluent :

- Les chemins de fichiers relatifs pour chaque fichier correspondant (préfixé avec #)
- Les lignes de contexte avant et après chaque correspondance (1 ligne par défaut)
- Les numéros de ligne remplis à 3 espaces suivis de `|` et le contenu de ligne
- Une ligne de séparateur (----) après chaque groupe de correspondance

Exemple de format de sortie :

```
# rel/path/to/app.ts
  11 |   // Une logique de traitement ici
  12 |   // TODO: Implémenter la gestion d'erreur
  13 |   return processedData;
----

# Affichage des 300 premiers de 300+ résultats. Utilisez une recherche plus spécifique si nécessaire.
```

Quand les correspondances se produisent proches les unes des autres, elles sont fusionnées en un seul bloc plutôt que montrées comme résultats séparés :

```
# rel/path/to/auth.ts
 13 | // Un peu de code ici
 14 | // TODO: Ajouter une validation appropriée
 15 | function validateUser(credentials) {
 16 | // TODO: Implémenter la limitation de débit
 17 |   return checkDatabase(credentials);
----
```

## Exemples d'Utilisation

- Quand demandé de refactoriser une fonction, Kilo Code recherche d'abord tous les endroits où la fonction est utilisée pour assurer des changements complets.
- Quand investiguer des bogues, Kilo Code recherche des motifs similaires pour identifier des problèmes liés à travers la base de code.
- Quand adresser la dette technique, Kilo Code localise tous les commentaires TODO à travers le projet.
- Quand analyser les dépendances, Kilo Code trouve tous les imports d'un module particulier.

## Exemples d'Usage

Rechercher des commentaires TODO dans tous les fichiers JavaScript :

```
<search_files>
<path>src</path>
<regex>TODO|FIXME</regex>
<file_pattern>*.js</file_pattern>
</search_files>
```

Trouver toutes les utilisations d'une fonction spécifique :

```
<search_files>
<path>.</path>
<regex>function\s+calculateTotal</regex>
<file_pattern>*.{js,ts}</file_pattern>
</search_files>
```

Rechercher un motif d'import spécifique à travers tout le projet :

```
<search_files>
<path>.</path>
<regex>import\s+.*\s+from\s+['"]@components/</regex>
</search_files>
```
