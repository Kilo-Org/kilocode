# Travail avec des Projets Importants

Kilo Code peut être utilisé avec des projets de toute taille, mais les projets importants nécessitent une attention particulière pour gérer efficacement le contexte. Voici quelques conseils pour travailler avec des bases de code importantes :

## Comprendre les Limites de Contexte

Kilo Code utilise des grands modèles de langage (LLM) qui ont une "fenêtre de contexte" limitée. Il s'agit de la quantité maximale de texte (mesurée en tokens) que le modèle peut traiter à la fois. Si le contexte est trop volumineux, le modèle peut ne pas être capable de comprendre votre demande ou de générer des réponses précises.

La fenêtre de contexte inclut :

- Le prompt système (instructions pour Kilo Code).
- L'historique de la conversation.
- Le contenu de tous les fichiers que vous mentionnez en utilisant `@`.
- La sortie de toutes les commandes ou outils que Kilo Code utilise.

## Stratégies de Gestion du Contexte

1.  **Soyez Spécifique :** Lorsque vous faites référence à des fichiers ou du code, utilisez des chemins de fichiers et des noms de fonctions spécifiques. Évitez les références vagues comme "le fichier principal".

2.  **Utilisez Efficacement les Mentions de Contexte :** Utilisez `@/chemin/vers/fichier.ts` pour inclure des fichiers spécifiques. Utilisez `@problems` pour inclure les erreurs et avertissements actuels. Utilisez `@` suivi d'un hash de commit pour référencer des commits Git spécifiques.

3.  **Décomposez les Tâches :** Divisez les tâches importantes en sous-tâches plus petites et plus gérables. Cela aide à maintenir le contexte concentré.

4.  **Résumez :** Si vous devez faire référence à une grande quantité de code, envisagez de résumer les parties pertinentes dans votre prompt au lieu d'inclure tout le code.

5.  **Priorisez l'Historique Récent :** Kilo Code tronque automatiquement les messages plus anciens dans l'historique de la conversation pour rester dans la fenêtre de contexte. Soyez conscient de cela, et ré-incluez le contexte important si nécessaire.

6.  **Utilisez le Cache de Prompt (si disponible) :** Certains fournisseurs d'API comme Anthropic, OpenAI, OpenRouter et Requesty supportent le "prompt caching". Cela met en cache vos prompts pour une utilisation dans les tâches futures et aide à réduire le coût et la latence des requêtes.

## Exemple : Refactorisation d'un Fichier Important

Supposons que vous devez refactoriser un fichier TypeScript important (`src/components/MyComponent.tsx`). Voici une approche possible :

1.  **Aperçu Initial :**

    ```
    @/src/components/MyComponent.tsx Liste les fonctions et classes dans ce fichier.
    ```

2.  **Cibler des Fonctions Spécifiques :**

    ```
    @/src/components/MyComponent.tsx Refactorise la fonction `processData` pour utiliser `async/await` au lieu des Promesses.
    ```

3.  **Changements Itératifs :** Apportez des petits changements incrémentaux, en examinant et approuvant chaque étape.

En décomposant la tâche et en fournissant un contexte spécifique, vous pouvez travailler efficacement avec des fichiers importants même avec une fenêtre de contexte limitée.
