# read_file

L'outil `read_file` examine le contenu des fichiers dans un projet. Il permet à Kilo Code de comprendre le code, les fichiers de configuration, et la documentation pour fournir une meilleure assistance.

## Paramètres

L'outil accepte ces paramètres :

- `path` (requis) : Le chemin du fichier à lire relatif au répertoire de travail actuel
- `start_line` (optionnel) : Le numéro de ligne de départ à partir duquel lire (indexation basée sur 1)
- `end_line` (optionnel) : Le numéro de ligne de fin jusqu'où lire (basé sur 1, inclusif)
- `auto_truncate` (optionnel) : Si tronquer automatiquement les gros fichiers quand la plage de lignes n'est pas spécifiée (true/false)

## Ce qu'il fait

Cet outil lit le contenu d'un fichier spécifié et le retourne avec des numéros de ligne pour référence facile. Il peut lire des fichiers entiers ou des sections spécifiques, et même extraire du texte depuis les PDF et documents Word.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de comprendre la structure de code existante
- Quand Kilo Code a besoin d'analyser des fichiers de configuration
- Quand Kilo Code a besoin d'extraire des informations depuis des fichiers texte
- Quand Kilo Code a besoin de voir le code avant de suggérer des changements
- Quand des numéros de ligne spécifiques doivent être référencés dans les discussions

## Caractéristiques Clés

- Affiche le contenu de fichier avec des numéros de ligne pour référence facile
- Peut lire des portions spécifiques de fichiers en spécifiant des plages de lignes
- Extrait le texte lisible depuis les fichiers PDF et DOCX
- Tronque intelligemment les gros fichiers pour se concentrer sur les sections les plus pertinentes
- Fournit des résumés de méthodes avec des plages de lignes pour les gros fichiers de code
- Diffuse efficacement seulement les plages de lignes demandées pour une meilleure performance
- Facilite la discussion de parties spécifiques de code avec numérotation de ligne

## Limitations

- Peut ne pas gérer efficacement les extrêmement gros fichiers sans utiliser de paramètres de plage de lignes
- Pour les fichiers binaires (sauf PDF et DOCX), peut retourner du contenu qui n'est pas lisible par l'humain

## Comment ça fonctionne

Quand l'outil `read_file` est invoqué, il suit ce processus :

1. **Validation de Paramètres** : Valide le paramètre `path` requis et les paramètres optionnels
2. **Résolution de Chemin** : Résout le chemin relatif vers un chemin absolu
3. **Sélection de Stratégie de Lecture** :
    - L'outil utilise une hiérarchie de priorité stricte (expliquée en détail ci-dessous)
    - Il choisit entre la lecture de plage, l'auto-troncature, ou la lecture de fichier complet
4. **Traitement de Contenu** :
    - Ajoute des numéros de ligne au contenu (par ex. "1 | const x = 13") où `1 |` est le numéro de ligne
    - Pour les fichiers tronqués, ajoute un avis de troncature et les définitions de méthodes
    - Pour les formats spéciaux (PDF, DOCX, IPYNB), extrait le texte lisible

## Priorité de Stratégie de Lecture

L'outil utilise une hiérarchie de décision claire pour déterminer comment lire un fichier :

1. **Première Priorité : Plage de Ligne Explicite**

    - Si soit `start_line` soit `end_line` est fourni, l'outil effectue toujours une lecture de plage
    - L'implémentation diffuse efficacement seulement les lignes demandées, le rendant approprié pour traiter les gros fichiers
    - Ceci prend priorité sur toutes les autres options

2. **Deuxième Priorité : Auto-Troncature pour les Gros Fichiers**

    - Ceci s'applique seulement quand TOUTES ces conditions sont remplies :
        - Ni `start_line` ni `end_line` n'est spécifié
        - Le paramètre `auto_truncate` est défini à `true`
        - Le fichier n'est pas un fichier binaire
        - Le fichier dépasse le seuil de lignes configuré (typiquement 500-1000 lignes)
    - Quand l'auto-troncature s'active, l'outil :
        - Lit seulement la première portion du fichier (déterminée par le paramètre maxReadFileLine)
        - Ajoute un avis de troncature montrant le nombre de lignes affichées vs total
        - Fournit un résumé des définitions de méthodes avec leurs plages de lignes

3. **Comportement Défaut : Lire le Fichier Entier**
    - Si aucune des conditions ci-dessus n'est remplie, il lit tout le contenu du fichier
    - Pour les formats spéciaux comme PDF, DOCX, et IPYNB, il utilise des extracteurs spécialisés

## Exemples d'Utilisation

- Quand demandé d'expliquer ou d'améliorer du code, Kilo Code lit d'abord les fichiers pertinents pour comprendre l'implémentation actuelle.
- Quand résoudre des problèmes de configuration, Kilo Code lit les fichiers de config pour identifier des problèmes potentiels.
- Quand travailler avec de la documentation, Kilo Code lit la documentation existante pour comprendre le contenu actuel avant de suggérer des améliorations.

## Exemples d'Usage

Voici plusieurs scénarios démontrant comment l'outil `read_file` est utilisé et la sortie typique que vous pourriez recevoir.

### Lire un Fichier Entier

Pour lire le contenu complet d'un fichier :

**Entrée :**

```xml
<read_file>
<path>src/app.js</path>
</read_file>
```

**Sortie Simulée (pour un petit fichier comme `example_small.txt`) :**

```
1 | C'est la première ligne.
2 | C'est la deuxième ligne.
3 | C'est la troisième ligne.
```

_(La sortie variera selon le contenu réel du fichier)_

### Lire des Lignes Spécifiques

Pour lire seulement une plage spécifique de lignes (par ex. 46-68) :

**Entrée :**

```xml
<read_file>
<path>src/app.js</path>
<start_line>46</start_line>
<end_line>68</end_line>
</read_file>
```

**Sortie Simulée (pour les lignes 2-3 de `example_five_lines.txt`) :**

```
2 | Contenu de la ligne deux.
3 | Contenu de la ligne trois.
```

_(La sortie montre seulement les lignes demandées avec leurs numéros de ligne originaux)_

### Lire un Gros Fichier (Auto-Troncature)

Quand on lit un gros fichier sans spécifier de lignes et `auto_truncate` est activé (ou défaut à true basé sur les paramètres) :

**Entrée :**

```xml
<read_file>
<path>src/large-module.js</path>
<auto_truncate>true</auto_truncate> <!-- Optionnel si défaut est true -->
</read_file>
```

**Sortie Simulée (pour `large_file.log` avec 1500 lignes, limite 1000) :**

```
1 | Entrée de log 1...
2 | Entrée de log 2...
...
1000 | Entrée de log 1000...
[... tronqué 500 lignes ...]
```

_(La sortie est limitée aux lignes maximum configurées, avec un avis de troncature)_

### Essayer de Lire un Fichier Non Existant

Si le fichier spécifié n'existe pas :

**Entrée :**

```xml
<read_file>
<path>non_existent_file.txt</path>
</read_file>
```

**Sortie Simulée (Erreur) :**

```
Erreur: Fichier non trouvé au chemin 'non_existent_file.txt'.
```

### Essayer de Lire un Fichier Bloqué

Si le fichier est exclu par les règles dans un fichier `.kilocodeignore` :

**Entrée :**

```xml
<read_file>
<path>.env</path>
</read_file>
```

**Sortie Simulée (Erreur) :**

```
Erreur: Accès refusé au fichier '.env' en raison des règles .kilocodeignore.
```
