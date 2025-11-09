# Fournisseur Relay Humain

Le fournisseur Relay Humain vous permet d'utiliser Kilo Code avec des modèles d'IA basés sur le web comme ChatGPT ou Claude sans avoir besoin d'une clé API. Au lieu de cela, il s'appuie sur vous pour relayer manuellement les messages entre Kilo Code et l'interface web de l'IA.

## Comment ça fonctionne

1.  **Sélectionner Relay Humain**: Choisissez "Relay Humain" comme votre fournisseur API dans les paramètres de Kilo Code. Aucune clé API n'est requise.
2.  **Initier une Requête**: Démarrez un chat ou une tâche avec Kilo Code comme d'habitude.
3.  **Invite de Dialogue**: Une boîte de dialogue apparaîtra dans VS Code. Votre message à l'IA est automatiquement copié dans votre presse-papiers.
4.  **Coller vers l'IA Web**: Allez à l'interface web de votre IA choisie (par ex., chat.openai.com, claude.ai) et collez le message de votre presse-papiers dans l'entrée de chat.
5.  **Copier la Réponse de l'IA**: Une fois que l'IA répond, copiez son texte de réponse complet.
6.  **Coller vers Kilo Code**: Retournez à la boîte de dialogue dans VS Code, collez la réponse de l'IA dans le champ désigné, et cliquez sur "Confirmer".
7.  **Continuer**: Kilo Code traitera la réponse comme si elle provenait directement d'une API.

## Cas d'Utilisation

Ce fournisseur est utile si :

- Vous voulez utiliser des modèles qui n'offrent pas d'accès API direct.
- Vous préférez ne pas gérer des clés API.
- Vous avez besoin d'exploiter les capacités spécifiques ou le contexte disponible seulement dans l'interface web de certains modèles d'IA.

## Limitations

- **Effort Manuel**: Nécessite une copie-colle constante entre VS Code et votre navigateur.
- **Interaction Plus Lente**: Le processus aller-retour est significativement plus lent que l'intégration API directe.
- **Potentiel d'Erreurs**: La copie et le collage manuels peuvent introduire des erreurs ou des omissions.

Choisissez ce fournisseur quand les bénéfices d'utiliser une IA web spécifique l'emportent sur l'inconvénient du processus de relais manuel.
