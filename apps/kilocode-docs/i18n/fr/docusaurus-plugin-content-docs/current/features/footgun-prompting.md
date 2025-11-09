---
sidebar_label: "Footgun Prompting"
---

# Footgun Prompting : Remplacer les Prompts Système

Footgun Prompting, aussi appelé Remplacement de Prompt Système, permet aux utilisateurs avancés de remplacer complètement le prompt système par défaut pour un mode Kilo Code spécifique. Cela fournit un contrôle granulaire sur le comportement de l'IA mais contourne les garde-fous intégrés.

:::info **footgun** _(nom)_

1.  _(argot de programmation, humoristique, péjoratif)_ Toute fonctionnalité susceptible de conduire le programmeur à se tirer une balle dans le pied.

> Le Remplacement de Prompt Système est considéré comme un footgun car modifier les instructions de base sans une compréhension approfondie peut mener à un comportement inattendu ou cassé, particulièrement concernant l'utilisation d'outils et la consistance des réponses.

:::

## Comment ça Fonctionne

1.  **Fichier de Remplacement :** Créez un fichier nommé `.kilocode/system-prompt-{mode-slug}` dans la racine de votre espace de travail (ex. `.kilocode/system-prompt-code` pour le mode Code).
2.  **Contenu :** Le contenu de ce fichier devient le nouveau prompt système pour ce mode spécifique.
3.  **Activation :** Kilo Code détecte automatiquement ce fichier. Quand il est présent, il remplace la plupart des sections de prompt système standard.
4.  **Sections Préservées :** Seulement la `roleDefinition` de base et toutes `customInstructions` que vous avez définies pour le mode sont gardées avec votre contenu de remplacement. Les sections standard comme les descriptions d'outils, règles, et capacités sont contournées.
5.  **Construction :** Le prompt final envoyé au modèle ressemble à ceci :

    ```
    ${roleDefinition}

    ${content_of_your_override_file}

    ${customInstructions}
    ```

## Accéder à la Fonctionnalité

Vous pouvez trouver l'option et les instructions dans l'UI Kilo Code :

1.  Cliquez sur le sélecteur de MODE dans le coin inférieur gauche de la boîte d'entrée de texte Kilo Code.
2.  Cliquez sur "Éditer..." au bas de la liste de sélection de mode
3.  Développez la section **"Avancé : Remplacer le Prompt Système"** en bas.
4.  Cliquer sur le lien de chemin de fichier dans l'explication ouvrira ou créera le fichier de remplacement correct pour le mode actuellement sélectionné dans VS Code.

<img src="/docs/img/footgun-prompting/footgun-prompting.png" alt="UI montrant la section Avancé : Remplacer le Prompt Système" width="500" />

## Considérations Clés et Avertissements

- **Public Cible :** Le mieux adapté pour les utilisateurs profondément familiers avec le système de prompting de Kilo Code et les implications de modifier les instructions de base.
- **Impact sur la Fonctionnalité :** Les prompts personnalisés remplacent les instructions standard, incluant celles pour l'utilisation d'outils et la consistance de réponse. Cela peut causer un comportement inattendu ou des erreurs si non géré soigneusement.
- **Spécifique au Mode :** Chaque fichier de remplacement s'applique seulement au mode spécifié dans son nom de fichier (`{mode-slug}`).
- **Pas de Fichier, Pas de Remplacement :** Si le fichier `.kilocode/system-prompt-{mode-slug}` n'existe pas, Kilo Code utilise le processus de génération de prompt système standard pour ce mode.
- **Création de Répertoire :** Kilo Code s'assure que le répertoire `.kilocode` existe avant d'essayer de lire ou créer le fichier de remplacement.

Utilisez cette fonctionnalité avec prudence. Bien que puissante pour la personnalisation, une implémentation incorrecte peut dégrader significativement les performances et la fiabilité de Kilo Code pour le mode affecté.
