# Conseils d'Ingénierie de Prompts

L'ingénierie de prompts est l'art de crafting instructions efficaces pour les modèles d'IA comme Kilo Code. Des prompts bien rédigés conduisent à de meilleurs résultats, moins d'erreurs et un workflow plus efficace.

## Principes Généraux

- **Soyez Clair et Spécifique :** Déclarez clairement ce que vous voulez que Kilo Code fasse. Évitez l'ambiguïté.

    - **Mauvais :** Corrige le code.
    - **Bon :** Corrige le bug dans la fonction `calculateTotal` qui la fait retourner des résultats incorrects.

- **Fournissez du Contexte :** Utilisez les [Mentions de Contexte](/basic-usage/context-mentions) pour faire référence à des fichiers, dossiers ou problèmes spécifiques.

    - **Bon :** `@/src/utils.ts` Refactorise la fonction `calculateTotal` pour utiliser async/await.

- **Décomposez les Tâches :** Divisez les tâches complexes en étapes plus petites et bien définies.

- **Donnez des Exemples :** Si vous avez un style de codage ou un pattern spécifique en tête, fournissez des exemples.

- **Spécifiez le Format de Sortie :** Si vous avez besoin de la sortie dans un format particulier (ex: JSON, Markdown), spécifiez-le dans le prompt.

- **Itérez :** N'hésitez pas à affiner votre prompt si les résultats initiaux ne sont pas ce que vous attendez.

## Réflexion vs Action

Il est souvent utile de guider Kilo Code à travers un processus "réfléchir-puis-agir" :

1.  **Analyser :** Demandez à Kilo Code d'analyser le code actuel, d'identifier les problèmes ou de planifier l'approche.
2.  **Planifier :** Faites en sorte que Kilo Code décrive les étapes qu'il va suivre pour compléter la tâche.
3.  **Exécuter :** Instruire Kilo Code pour implémenter le plan, une étape à la fois.
4.  **Examiner :** Examinez attentivement les résultats de chaque étape avant de procéder.

## Utilisation des Instructions Personnalisées

Vous pouvez fournir des instructions personnalisées pour adapter davantage le comportement de Kilo Code. Il existe deux types d'instructions personnalisées :

- **Instructions Personnalisées Globales :** S'appliquent à tous les modes.
- **Instructions Personnalisées Spécifiques au Mode :** S'appliquent seulement à un mode spécifique (ex: Code, Architect, Ask, Debug, ou un mode personnalisé).

Les instructions personnalisées sont ajoutées au prompt système, fournissant une guidance persistante au modèle d'IA. Vous pouvez les utiliser pour :

- Imposer des directives de style de codage.
- Spécifier des bibliothèques ou frameworks préférés.
- Définir des conventions spécifiques au projet.
- Ajuster le ton ou la personnalité de Kilo Code.

Voir la section [Instructions Personnalisées](/advanced-usage/custom-instructions) pour plus de détails.

## Gestion de l'Ambiguïté

Si votre demande est ambiguë ou manque de détails suffisants, Kilo Code pourrait :

- **Faire des Suppositions :** Il pourrait procéder basé sur sa meilleure estimation, qui pourrait ne pas être ce que vous intended.
- **Poser des Questions de Suivi :** Il pourrait utiliser l'outil `ask_followup_question` pour clarifier votre demande.

Il est généralement préférable de fournir des instructions claires et spécifiques dès le début pour éviter les allers-retours inutiles.

## Fournir du Feedback

Si Kilo Code ne produit pas les résultats souhaités, vous pouvez fournir du feedback en :

- **Rejetant les Actions :** Cliquez sur le bouton "Rejeter" lorsque Kilo Code propose une action que vous ne voulez pas.
- **Fournissant des Explications :** Lors du rejet, expliquez _pourquoi_ vous rejetez l'action. Cela aide Kilo Code à apprendre de ses erreurs.
- **Reformulant Votre Demande :** Essayez de reformuler votre tâche initiale ou de fournir des instructions plus spécifiques.
- **Corrigeant Manuellement :** S'il y a quelques petits problèmes, vous pouvez aussi directement modifier le code avant d'accepter les changements.

## Exemples

**Bon Prompt :**

> `@/src/components/Button.tsx` Refactorise le composant `Button` pour utiliser le hook `useState` au lieu du hook `useReducer`.

**Mauvais Prompt :**

> Corrige le bouton.

**Bon Prompt :**

> Crée un nouveau fichier nommé `utils.py` et ajoute une fonction appelée `calculate_average` qui prend une liste de nombres et retourne leur moyenne.

**Mauvais Prompt :**

> Écris du code Python.

**Bon Prompt :**

> `@problems` Adresse toutes les erreurs et avertissements dans le fichier actuel.

**Mauvais Prompt :**

> Corrige tout.

En suivant ces conseils, vous pouvez écrire des prompts efficaces qui tirent le meilleur parti des capacités de Kilo Code.
