# Améliorer le Prompt

La fonctionnalité "Améliorer le Prompt" dans Kilo Code vous aide à améliorer la qualité et l'efficacité de vos prompts avant de les envoyer au modèle IA. En cliquant sur l'icône <Codicon name="sparkle" /> dans l'entrée de chat, vous pouvez automatiquement affiner votre demande initiale, la rendant plus claire, plus spécifique, et plus susceptible de produire les résultats désirés.

## Pourquoi Utiliser Améliorer le Prompt ?

- **Clarté Améliorée :** Kilo Code peut reformuler votre prompt pour le rendre plus compréhensible pour le modèle IA.
- **Contexte Ajouté :** Le processus d'amélioration peut ajouter du contexte pertinent à votre prompt, tel que le chemin de fichier actuel ou le code sélectionné.
- **Meilleures Instructions :** Kilo Code peut ajouter des instructions pour guider l'IA vers une réponse plus utile (ex. demander un formatage spécifique ou un niveau de détail particulier).
- **Ambiguïté Réduite :** Améliorer le Prompt aide à éliminer l'ambiguïté et s'assurer que Kilo Code comprend votre intention.
- **Consistance :** Kilo formatera toujours les prompts de la même manière vers l'IA.

### Avant et après

<img src="/docs/img/enhance-prompt/before.png" alt="prompt très primitif" width="300" style={{display: 'inline-block', marginRight: '20px', verticalAlign: 'middle'}} />
<img src="/docs/img/enhance-prompt/after.png" alt="prompt amélioré" width="300" style={{display: 'inline-block', verticalAlign: 'middle'}} />

## Comment Utiliser Améliorer le Prompt

1.  **Tapez votre prompt initial :** Entrez votre demande dans la boîte d'entrée de chat Kilo Code comme vous le feriez normalement. Cela peut être une question simple, une description de tâche complexe, ou quelque chose entre les deux.
2.  **Cliquez sur l'Icône <Codicon name="sparkle" /> :** Au lieu d'appuyer sur Entrée, cliquez sur l'icône <Codicon name="sparkle" /> située dans le coin inférieur droit de la boîte d'entrée de chat.
3.  **Révisez le Prompt Amélioré :** Kilo Code remplacera votre prompt original par une version améliorée. Révisez le prompt amélioré pour vous assurer qu'il reflète fidèlement votre intention. Vous pouvez davantage affiner le prompt amélioré avant de l'envoyer.
4.  **Envoyez le Prompt Amélioré :** Appuyez sur Entrée ou cliquez sur l'icône Envoyer (<Codicon name="send" />) pour envoyer le prompt amélioré à Kilo Code.

## Personnaliser le Processus d'Amélioration

### Personnaliser le Template

La fonctionnalité "Améliorer le Prompt" utilise un template de prompt personnalisable. Vous pouvez modifier ce template pour adapter le processus d'amélioration à vos besoins spécifiques.

1.  **Ouvrez l'Onglet Prompts :** Cliquez sur l'icône <Codicon name="notebook" /> dans la barre de menu supérieure de Kilo Code.
2.  **Sélectionnez l'Onglet "AMÉLIORER" :** Vous devriez voir listés les prompts de support, incluant "AMÉLIORER". Cliquez sur cet onglet.
3.  **Éditer le Template de Prompt :** Modifiez le texte dans le champ "Prompt".

Le template de prompt par défaut inclut le placeholder `${userInput}`, qui sera remplacé par votre prompt original. Vous pouvez le modifier pour s'adapter au format de prompt du modèle, et lui instructer comment améliorer votre demande.

### Personnaliser le Fournisseur

Accélérez l'amélioration de prompt en basculant vers un fournisseur de modèle LLM plus léger (ex. GPT 4.1 Nano). Cela livre des résultats plus rapides à moindre coût tout en maintenant la qualité.

Créez un profil dédié pour Améliorer le Prompt en suivant le [guide des profils de configuration API](/features/api-configuration-profiles).

<img src="/docs/img/enhance-prompt/custom-enhance-profile.png" alt="Configuration de profil personnalisé pour la fonctionnalité Améliorer le Prompt" width="600" />

Pour une walkthrough détaillée : https://youtu.be/R1nDnCK-xzw

## Limitations et Meilleures Pratiques

- **Fonctionnalité Expérimentale :** L'amélioration de prompt est une fonctionnalité expérimentale. La qualité du prompt amélioré peut varier selon la complexité de votre demande et les capacités du modèle sous-jacent.
- **Révisez Soigneusement :** Révisez toujours le prompt amélioré avant de l'envoyer. Kilo Code peut faire des changements qui ne s'alignent pas avec vos intentions.
- **Processus Itératif :** Vous pouvez utiliser la fonctionnalité "Améliorer le Prompt" plusieurs fois pour affiner itérativement votre prompt.
- **Pas un Remplacement pour des Instructions Claires :** Tandis que "Améliorer le Prompt" peut aider, il est encore important d'écrire des prompts clairs et spécifiques dès le départ.

En utilisant la fonctionnalité "Améliorer le Prompt", vous pouvez améliorer la qualité de vos interactions avec Kilo Code et obtenir des réponses plus précises et utiles.
