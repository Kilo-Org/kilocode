# apply_diff

L'outil `apply_diff` effectue des modifications précises et chirurgicales aux fichiers en spécifiant exactement quel contenu remplacer. Il utilise plusieurs stratégies sophistiquées pour trouver et appliquer les changements tout en maintenant le formatage et la structure appropriés du code.

## Paramètres

L'outil accepte ces paramètres :

- `path` (requis) : Le chemin du fichier à modifier relatif au répertoire de travail actuel.
- `diff` (requis) : Le bloc de recherche/remplacement définissant les changements. **Les numéros de ligne sont obligatoires dans le format de contenu diff** pour toutes les stratégies actuellement implémentées.

**Note** : Bien que le système soit conçu pour être extensible avec différentes stratégies diff, toutes les stratégies actuellement implémentées nécessitent que les numéros de ligne soient spécifiés dans le contenu diff lui-même en utilisant le marqueur `:start_line:`.

## Ce qu'il fait

Cet outil applique des changements ciblés aux fichiers existants en utilisant des stratégies sophistiquées pour localiser et remplacer le contenu précisément. Contrairement à la recherche et remplacement simples, il utilise des algorithmes de correspondance intelligents (y compris la correspondance floue) qui s'adaptent à différents types de contenu et tailles de fichiers, avec des mécanismes de fallback pour les modifications complexes.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin de faire des modifications précises au code existant sans réécrire des fichiers entiers.
- Quand refactoriser des sections spécifiques de code tout en maintenant le contexte environnant.
- Quand corriger des bogues dans le code existant avec une précision chirurgicale.
- Quand implémenter des améliorations de fonctionnalités qui modifient seulement certaines parties d'un fichier.

## Caractéristiques Clés

- Utilise la correspondance floue intelligente avec des seuils de confiance configurables (typiquement 0.8-1.0).
- Fournit le contexte autour des correspondances en utilisant `BUFFER_LINES` (par défaut 40).
- Employe une approche de fenêtre chevauchante pour rechercher dans les gros fichiers.
- Préserve le formatage et l'indentation du code automatiquement.
- Combine les correspondances chevauchantes pour améliorer le score de confiance.
- Affiche les changements dans une vue diff pour révision et édition utilisateur avant application.
- Suit les erreurs consécutives par fichier (`consecutiveMistakeCountForApplyDiff`) pour prévenir les échecs répétés.
- Valide l'accès aux fichiers contre les règles `.kilocodeignore`.
- Gère efficacement les modifications multi-lignes.

## Limitations

- Fonctionne mieux avec des sections de code uniques et distinctives pour une identification fiable.
- La performance peut varier avec des très gros fichiers ou des motifs de code hautement répétitifs.
- La correspondance floue peut occasionnellement sélectionner des emplacements incorrects si le contenu est ambigu.
- Chaque stratégie diff a des exigences de format spécifiques.
- Les modifications complexes peuvent nécessiter une sélection de stratégie prudente ou une révision manuelle.

## Comment ça fonctionne

Quand l'outil `apply_diff` est invoqué, il suit ce processus :

1.  **Validation de Paramètres** : Valide les paramètres `path` et `diff` requis.
2.  **Vérification KiloCodeIgnore** : Valide si le chemin du fichier cible est autorisé par les règles `.kilocodeignore`.
3.  **Analyse de Fichier** : Charge le contenu du fichier cible.
4.  **Trouvé de Correspondance** : Utilise les algorithmes de la stratégie choisie (exacte, floue, fenêtres chevauchantes) pour localiser le contenu cible, en considérant les seuils de confiance et le contexte (`BUFFER_LINES`).
5.  **Préparation de Changement** : Génère les changements proposés, préservant l'indentation.
6.  **Interaction Utilisateur** :
    - Affiche les changements dans une vue diff.
    - Permet à l'utilisateur de réviser et potentiellement éditer les changements proposés.
    - Attend l'approbation ou le rejet utilisateur.
7.  **Application de Changement** : Si approuvé, applique les changements (potentiellement incluant les éditions utilisateur) au fichier.
8.  **Gestion d'Erreur** : Si des erreurs se produisent (p. ex. échec de correspondance, application partielle), incrémente le `consecutiveMistakeCountForApplyDiff` pour le fichier et reporte le type d'échec.
9.  **Retour** : Retourne le résultat, incluant tout retour utilisateur ou détails d'erreur.

## Stratégie Diff

Kilo Code utilise cette stratégie pour appliquer les diffs :

### MultiSearchReplaceDiffStrategy

Un format de recherche/remplacement amélioré supportant plusieurs changements en une seule requête. **Les numéros de ligne sont obligatoires pour chaque bloc de recherche.**

- **Meilleur pour** : Plusieurs changements distincts où les numéros de ligne sont connus ou peuvent être estimés.
- **Nécessite** : Correspondance exacte pour le contenu du bloc `SEARCH`, incluant l'espacement et l'indentation. Le marqueur `:start_line:` est **obligatoire** dans chaque bloc SEARCH. Les marqueurs dans le contenu doivent être échappés (`\`).

Exemple de format pour le bloc `<diff>` :

```diff
<<<<<<< SEARCH
:start_line:10
:end_line:12
-------
    // Ancien logique de calcul
    const result = value * 0.9;
    return result;
=======
    // Logique de calcul mise à jour avec journalisation
    console.log(`Calculating for value: ${value}`);
    const result = value * 0.95; // Facteur ajusté
    return result;
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:25
:end_line:25
-------
    const defaultTimeout = 5000;
=======
    const defaultTimeout = 10000; // Timeout augmenté
>>>>>>> REPLACE
```
