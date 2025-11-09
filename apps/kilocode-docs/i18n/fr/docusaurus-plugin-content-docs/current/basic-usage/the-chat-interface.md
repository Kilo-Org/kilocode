import Image from '@site/src/components/Image';

# Discuter avec Kilo Code

:::tip

**En résumé :** Kilo Code est un assistant de codage IA qui vit dans VS Code. Vous discutez avec lui en anglais simple, et il écrit, modifie et explique le code pour vous.

:::

## Configuration rapide

Trouvez l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la Barre latérale principale de VS Code. Cliquez dessus pour ouvrir le panneau de chat.

**Panneau perdu ?** Allez dans Affichage > Ouvrir la vue... et recherchez "Kilo Code"

## Comment parler à Kilo Code

**L'idée clé :** Tapez simplement ce que vous voulez en anglais normal. Aucune commande spéciale nécessaire.

<Image src="/docs/img/typing-your-requests/typing-your-requests.png" alt="Exemple de saisie d'une demande dans Kilo Code" width="600" />

**Bonnes demandes :**

```
créez un nouveau fichier nommé utils.py et ajoutez une fonction appelée add qui prend deux nombres comme arguments et retourne leur somme
```

```
dans le fichier @src/components/Button.tsx, changez la couleur du bouton en bleu
```

```
trouvez toutes les instances de la variable oldValue dans @/src/App.js et remplacez-les par newValue
```

**Ce qui fait fonctionner les demandes :**

- **Soyez spécifique** - "Corrigez le bug dans `calculateTotal` qui retourne des résultats incorrects" est mieux que "Corrigez le code"
- **Utilisez des mentions @** - Référencez des fichiers et du code directement avec `@nomdefichier`
- **Une tâche à la fois** - Divisez le travail complexe en étapes gérables
- **Incluez des exemples** - Montrez le style ou le format que vous voulez

## L'interface de chat

<Image 
    src="/docs/img/the-chat-interface/the-chat-interface-1.png" 
    alt="Composants de l'interface de chat étiquetés avec des callouts" width="750" 
    caption="Tout ce dont vous avez besoin est right ici"
/>

**Contrôles essentiels :**

- **Historique de chat** - Voyez votre conversation et l'historique des tâches
- **Champ de saisie** - Tapez vos demandes ici (appuyez sur Entrée pour envoyer)
- **Boutons d'action** - Approuvez ou rejetez les changements proposés par Kilo
- **Bouton plus** - Commencez une nouvelle session de tâche
- **Sélecteur de mode** - Choisissez comment Kilo doit aborder votre tâche

## Interactions rapides

**Cliquez pour agir :**

- Chemins de fichiers → Ouvre le fichier
- URLs → Ouvre dans le navigateur
- Messages → Développe/réduit les détails
- Blocs de code → Le bouton copier apparaît

**Signaux de statut :**

- Rotation → Kilo travaille
- Rouge → Une erreur s'est produite
- Vert → Succès

## Erreurs courantes à éviter

| Au lieu de ça...                      | Essayez ça                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| "Corrigez le code"                    | "Corrigez le bug dans `calculateTotal` qui retourne des résultats incorrects" |
| Supposer que Kilo connaît le contexte | Utilisez `@` pour référencer des fichiers spécifiques                         |
| Tâches multiples non liées            | Soumettez une demande ciblée à la fois                                        |
| Surcharge de jargon technique         | Un langage clair et simple fonctionne mieux                                   |

**Pourquoi c'est important :** Kilo Code fonctionne mieux lorsque vous communiquez comme si vous parliez à un collègue intelligent qui a besoin de directives claires.

Prêt à commencer à coder ? Ouvrez le panneau de chat et décrivez ce que vous voulez construire !
