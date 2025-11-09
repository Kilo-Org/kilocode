# Éditions Rapides

:::info Paramètre par Défaut
Les Éditions Rapides (en utilisant le paramètre "Activer l'édition via des diffs") est activé par défaut dans Kilo Code. Vous n'avez typiquement pas besoin de changer ces paramètres sauf si vous rencontrez des problèmes spécifiques ou voulez expérimenter avec différentes stratégies de diff.
:::

Kilo Code offre un paramètre avancé pour changer comment il édite les fichiers, en utilisant des diffs (différences) au lieu de réécrire des fichiers entiers. Activer cette fonctionnalité fournit des avantages significatifs.

## Activer l'Édition via des Diffs

Ouvrez les Paramètres en cliquant sur l'icône d'engrenage <Codicon name="gear" /> → Avancé

Quand **Activer l'édition via des diffs** est coché :

    <img src="/docs/img/fast-edits/fast-edits-5.png" alt="Paramètres Kilo Code montrant Activer l'édition via des diffs" width="500" />

1.  **Édition de Fichiers Plus Rapide :** Kilo modifie les fichiers plus rapidement en appliquant seulement les changements nécessaires.
2.  **Empêche les Écritures Tronquées :** Le système détecte et rejette automatiquement les tentatives par l'IA d'écrire du contenu de fichier incomplet, ce qui peut arriver avec de gros fichiers ou des instructions complexes. Cela aide à prévenir les fichiers corrompus.

:::note Désactiver les Éditions Rapides
Si vous décochez **Activer l'édition via des diffs**, Kilo reviendra à écrire le contenu de fichier entier pour chaque édition en utilisant l'outil [`write_to_file`](/features/tools/write-to-file), au lieu d'appliquer des changements ciblés avec [`apply_diff`](/features/tools/apply-diff). Cette approche d'écriture complète est généralement plus lente pour modifier les fichiers existants et mène à une utilisation de tokens plus élevée.
:::

## Précision de Correspondance

Ce curseur contrôle à quel point les sections de code identifiées par l'IA doivent correspondre au code réel dans votre fichier avant qu'un changement soit appliqué.

    <img src="/docs/img/fast-edits/fast-edits-4.png" alt="Paramètres Kilo Code montrant la case à cocher Activer l'édition via des diffs et le curseur Précision de correspondance" width="500" />

- **100% (Par Défaut)** : Nécessite une correspondance exacte. C'est l'option la plus sûre, minimisant le risque de changements incorrects.
- **Valeurs Plus Faibles (80%-99%)** : Permet la correspondance "floue". Kilo peut appliquer des changements même si la section de code a des différences mineures de ce que l'IA attendait. Cela peut être utile si le fichier a été légèrement modifié, mais **augmente le risque** d'appliquer des changements au mauvais endroit.

**Utilisez les valeurs en dessous de 100% avec prudence extrême.** Une précision plus faible pourrait être nécessaire occasionnellement, mais révisez toujours soigneusement les changements proposés.

Intérieurement, ce paramètre ajuste un `fuzzyMatchThreshold` utilisé avec des algorithmes comme la distance de Levenshtein pour comparer la similarité de code.
