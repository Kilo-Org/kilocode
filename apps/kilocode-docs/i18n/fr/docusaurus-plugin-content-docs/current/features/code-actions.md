import Image from '@site/src/components/Image';

# Actions de Code

Les Actions de Code sont une fonctionnalité puissante de VS Code qui fournit des corrections rapides, des refactorisations et d'autres suggestions liées au code directement dans l'éditeur. Kilo Code s'intègre à ce système pour offrir une assistance alimentée par l'IA pour les tâches de codage communes.

## Que sont les Actions de Code ?

Les Actions de Code apparaissent comme une icône d'ampoule (💡) dans la gouttière de l'éditeur (la zone à gauche des numéros de ligne). Elles peuvent aussi être accédées via le menu contextuel du clic droit, ou via un raccourci clavier. Elles sont déclenchées quand :

- Vous sélectionnez une plage de code.
- Votre curseur est sur une ligne avec un problème (erreur, avertissement ou indice).
- Vous les invoquez via une commande.

Cliquer sur l'ampoule, faire un clic droit et sélectionner "Kilo Code", ou utiliser le raccourci clavier (`Ctrl+.` ou `Cmd+.` sur macOS, par défaut), affiche un menu d'actions disponibles.

<Image src="/docs/img/code-actions/code-actions-1.png" alt="Actions de code VS Code alignées avec le code" width="500" />

## Actions de Code de Kilo Code

Kilo Code fournit les Actions de Code suivantes :

- **Ajouter au Contexte :** Ajoute rapidement le code sélectionné à votre chat avec Kilo, incluant les numéros de ligne pour que Kilo sache exactement d'où vient le code. Il est listé en premier dans le menu pour un accès facile. (Plus de détails ci-dessous).
- **Expliquer le Code :** Demande à Kilo Code d'expliquer le code sélectionné.
- **Corriger le Code :** Demande à Kilo Code de corriger les problèmes dans le code sélectionné (disponible quand les diagnostics sont présents).
- **Améliorer le Code :** Demande à Kilo Code de suggérer des améliorations pour le code sélectionné.

### Plongée Profonde Ajouter au Contexte

L'action **Ajouter au Contexte** est listée en premier dans le menu Actions de Code pour que vous puissiez rapidement ajouter des extraits de code à votre conversation. Quand vous l'utilisez, Kilo Code inclut le nom de fichier et les numéros de ligne avec le code.

Cela aide Kilo à comprendre le contexte exact de votre code dans le projet, lui permettant de fournir une assistance plus pertinente et précise.

<Image src="/docs/img/code-actions/add-to-context.gif" alt="actions de code - gif ajouter au contexte" width="80%" />

**Exemple d'Entrée de Chat :**

```
Pouvez-vous expliquer cette fonction ?
@monFichier.js:15:25
```

_(`@monFichier.js:15:25` représente le code ajouté via "Ajouter au Contexte")_

Chacune de ces actions peut être effectuée "dans une nouvelle tâche" ou "dans la tâche actuelle".

## Utiliser les Actions de Code

Il y a trois façons principales d'utiliser les Actions de Code de Kilo Code :

### 1. Depuis l'Ampoule (💡)

1.  **Sélectionnez le Code :** Sélectionnez le code avec lequel vous voulez travailler. Vous pouvez sélectionner une seule ligne, plusieurs lignes, ou un bloc entier de code.
2.  **Cherchez l'Ampoule :** Une icône d'ampoule apparaîtra dans la gouttière à côté du code sélectionné (ou la ligne avec l'erreur/avertissement).
3.  **Cliquez sur l'Ampoule :** Cliquez sur l'icône d'ampoule pour ouvrir le menu Actions de Code.
4.  **Choisissez une Action :** Sélectionnez l'action Kilo Code désirée depuis le menu.
5.  **Réviser et Approuver :** Kilo Code proposé une solution dans le panneau de chat. Révisez les changements proposés et approuvez-les ou rejetez-les.

### 2. Depuis le Menu Contextuel du Clic Droit

1.  **Sélectionnez le Code :** Sélectionnez le code avec lequel vous voulez travailler.
2.  **Clic Droit :** Faites un clic droit sur le code sélectionné pour ouvrir le menu contextuel.
3.  **Choisissez "Kilo Code :** Sélectionnez l'option "Kilo Code" depuis le menu contextuel. Un sous-menu apparaîtra avec les actions Kilo Code disponibles.
4.  **Choisissez une Action :** Sélectionnez l'action désirée depuis le sous-menu.
5.  **Réviser et Approuver :** Kilo Code proposé une solution dans le panneau de chat. Révisez les changements proposés et approuvez-les ou rejetez-les.

### 3. Depuis la Palette de Commandes

1.  **Sélectionnez le Code :** Sélectionnez le code avec lequel vous voulez travailler.
2.  **Ouvrez la Palette de Commandes :** Appuyez sur `Ctrl+Shift+P` (Windows/Linux) ou `Cmd+Shift+P` (macOS).
3.  **Tapez une Commande :** Tapez "Kilo Code" pour filtrer les commandes, puis choisissez l'action de code relevante (ex. "Kilo Code : Expliquer le Code"). Vous pouvez aussi taper le début de la commande, comme "Kilo Code : Expliquer", et sélectionner depuis la liste filtrée.
4.  **Réviser et Approuver :** Kilo Code proposé une solution dans le panneau de chat. Révisez les changements proposés et approuvez-les ou rejetez-les.

## Actions de Code et Tâche Actuelle

Chaque action de code vous donne deux options :

- **dans Nouvelle Tâche :** Sélectionnez ceci pour commencer une conversation avec Kilo centrée sur cette action de code.
- **dans Tâche Actuelle :** Si une conversation a déjà commencé, cette option ajoutera l'action de code comme message additionnel.

## Personnaliser les Prompts d'Action de Code

Vous pouvez personnaliser les prompts utilisés pour chaque Action de Code en modifiant les "Prompts de Support" dans l'onglet **Prompts**. Cela vous permet d'affiner les instructions données au modèle IA et d'adapter les réponses à vos besoins spécifiques.

1.  **Ouvrez l'Onglet Prompts :** Cliquez sur l'icône <Codicon name="notebook" /> dans la barre de menu supérieure de Kilo Code.
2.  **Trouvez "Prompts de Support" :** Vous verrez les prompts de support, incluant "Améliorer le Prompt", "Expliquer le Code", "Corriger le Code", et "Améliorer le Code".
3.  **Éditer les Prompts :** Modifiez le texte dans la zone de texte pour le prompt que vous voulez personnaliser. Vous pouvez utiliser des placeholders comme `${filePath}` et `${selectedText}` pour inclure des informations sur le fichier actuel et la sélection.
4.  **Cliquez "Terminé" :** Sauvegardez vos changements.

En utilisant les Actions de Code de Kilo Code, vous pouvez obtenir rapidement une assistance alimentée par l'IA directement dans votre flux de travail de codage. Cela peut vous faire gagner du temps et vous aider à écrire de meilleurs codes.
