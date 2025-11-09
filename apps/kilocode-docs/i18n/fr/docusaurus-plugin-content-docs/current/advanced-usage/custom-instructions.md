# Instructions Personnalisées

Les Instructions Personnalisées vous permettent de personnaliser le comportement de Kilo Code, fournissant des directives spécifiques qui façonnent les réponses, le style de codage et les processus de prise de décision.

## Qu'est-ce que les Instructions Personnalisées ?

Les Instructions Personnalisées définissent des comportements spécifiques de l'extension, des préférences et des contraintes au-delà de la définition de rôle de base de Kilo. Les exemples incluent le style de codage, les standards de documentation, les exigences de test et les directives de workflow.

:::info Instructions Personnalisées vs Règles
Les Instructions Personnalisées s'appliquent à toute l'IDE et sont appliquées à tous les espaces de travail, maintaining vos préférences quel que soit le projet sur lequel vous travaillez. Contrairement aux Instructions, les [Règles Personnalisées](/advanced-usage/custom-rules.md) sont spécifiques au projet et vous permettent de configurer des ensembles de règles basées sur l'espace de travail.
:::

## Configuration des Instructions Personnalisées

**Comment les configurer :**

<img src="/docs/img/custom-instructions/custom-instructions.png" alt="Onglet Modes Kilo Code montrant l'interface des instructions personnalisées globales" width="600" />
1.  **Ouvrir l'onglet Modes :** Cliquez sur l'icône <Codicon name="organization" /> dans la barre de menu supérieure de Kilo Code
2.  **Trouver la section :** Trouvez la section "Instructions Personnalisées pour Tous les Modes"
3.  **Saisir les instructions :** Saisissez vos instructions dans la zone de texte
4.  **Sauvegarder les modifications :** Cliquez sur "Terminé" pour sauvegarder vos modifications

#### Instructions Spécifiques au Mode

Les instructions spécifiques au mode peuvent être configurées via l'onglet Modes

    <img src="/docs/img/custom-instructions/custom-instructions-3.png" alt="Onglet Modes Kilo Code montrant l'interface des instructions personnalisées spécifiques au mode" width="600" />
    * **Ouvrir l'onglet :** Cliquez sur l'icône <Codicon name="organization" /> dans la barre de menu supérieure de Kilo Code
    * **Sélectionner le mode :** Sous l'en-tête Modes, cliquez sur le bouton du mode que vous souhaitez personnaliser
    * **Saisir les instructions :** Saisissez vos instructions dans la zone de texte sous "Instructions Personnalisées Spécifiques au Mode (optionnel)"
    * **Sauvegarder les modifications :** Cliquez sur "Terminé" pour sauvegarder vos modifications

        :::info Règles de Mode Global
        Si le mode lui-même est global (non spécifique à l'espace de travail), toutes les instructions personnalisées que vous définissez pour lui s'appliqueront également globalement pour ce mode sur tous les espaces de travail.
        :::

## Fonctionnalités Connexes

- [Modes Personnalisés](/docs/features/custom-modes)
- [Règles Personnalisées](/advanced-usage/custom-rules)
- [Gestion des Paramètres](/docs/features/settings-management)
- [Paramètres d'Auto-Approbation](/docs/features/auto-approving-actions)
