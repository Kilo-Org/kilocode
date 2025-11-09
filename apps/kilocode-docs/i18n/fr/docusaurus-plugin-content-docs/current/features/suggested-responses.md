---
sidebar_label: Réponses Suggérées
---

import Codicon from '@site/src/components/Codicon';

# Réponses Suggérées

Quand Kilo Code a besoin de plus d'informations pour compléter une tâche, il utilise l'outil [`ask_followup_question`](/features/tools/ask-followup-question). Pour rendre la réponse plus facile et plus rapide, Kilo Code fournit souvent des réponses suggérées junto à la question.

## Vue d'Ensemble

Les Réponses Suggérées apparaissent comme des boutons cliquables directement sous la question de Kilo Code dans l'interface de chat. Elles offrent des réponses préformulées pertinentes à la question, vous aidant à fournir une entrée rapidement.

<img src="/docs/img/suggested-responses/suggested-responses.png" alt="Exemple de Kilo Code posant une question avec des boutons de réponse suggérée en dessous" width="500" />

## Comment ça Fonctionne

1.  **Question Apparaît**: Kilo Code pose une question en utilisant l'outil `ask_followup_question`.
2.  **Suggestions Affichées**: Si des suggestions sont fournies par Kilo Code, elles apparaissent comme des boutons sous la question.
3.  **Interaction**: Vous pouvez interagir avec ces suggestions de deux façons.

## Interagir avec les Suggestions

Vous avez deux options pour utiliser les réponses suggérées :

1.  **Sélection Directe**:

    - **Action**: Cliquez simplement sur le bouton contenant la réponse que vous voulez fournir.
    - **Résultat**: La réponse sélectionnée est immédiatement renvoyée à Kilo Code comme votre réponse. C'est la façon la plus rapide de répondre si une des suggestions correspond parfaitement à votre intention.

2.  **Éditer Avant d'Envoyer**:
    - **Action**:
        - Maintenez `Shift` et cliquez sur le bouton de suggestion.
        - _Alternativement_, survolez le bouton de suggestion et cliquez sur l'icône crayon (<Codicon name="edit" />) qui apparaît.
    - **Résultat**: Le texte de la suggestion est copié dans la boîte d'entrée de chat. Vous pouvez ensuite modifier le texte comme nécessaire avant d'appuyer sur Entrée pour envoyer votre réponse personnalisée. C'est utile quand une suggestion est proche mais nécessite des ajustements mineurs.

<img src="/docs/img/suggested-responses/suggested-responses-1.png" alt="Boîte d'entrée de chat montrant le texte copié depuis une réponse suggérée, prête pour l'édition" width="600" />

## Avantages

- **Vitesse**: Répondez rapidement sans taper des réponses complètes.
- **Clarté**: Les suggestions clarifient souvent le type d'information dont Kilo Code a besoin.
- **Flexibilité**: Éditer les suggestions pour fournir des réponses précises et personnalisées quand nécessaire.

Cette fonctionnalité rationalise l'interaction quand Kilo Code nécessite une clarification, vous permettant de guider la tâche efficacement avec un effort minimal.
