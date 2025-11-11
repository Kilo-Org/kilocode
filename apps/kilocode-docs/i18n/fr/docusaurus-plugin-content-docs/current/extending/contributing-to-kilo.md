# Contribuer à Kilo Code

Kilo Code est un projet open-source qui accueille les contributions de développeurs de tous niveaux. Ce guide vous aidera à démarrer avec la contribution à Kilo Code, que vous corrigiez des bogues, ajoutiez des fonctionnalités, amélioriez la documentation ou partagiez des modes personnalisés.

## Façons de Contribuer

Il existe de nombreuses façons de contribuer à Kilo Code :

1. **Contributions de Code** : Implémenter de nouvelles fonctionnalités ou corriger des bogues
2. **Documentation** : Améliorer la documentation existante ou créer de nouveaux guides
3. **Modes Personnalisés** : Créer et partager des modes spécialisés
4. **Rapports de Bogues** : Signaler les problèmes que vous rencontrez
5. **Demandes de Fonctionnalités** : Suggérer de nouvelles fonctionnalités ou améliorations
6. **Support Communautaire** : Aider les autres utilisateurs dans la communauté

## Configuration de l'Environnement de Développement

La Configuration de l'Environnement de Développement est décrite en détail sur [cette page](/docs/extending/development-environment.md)

## Flux de Travail de Développement

### Stratégie de Branchement

- Créez une nouvelle branche pour chaque fonctionnalité ou correction de bogue
- Utilisez des noms de branches descriptifs (par exemple, `feature/new-tool-support` ou `fix/browser-action-bug`)

```bash
git checkout -b your-branch-name
```

### Standards de Codage

- Suivez le style de code et les patterns existants
- Utilisez TypeScript pour le nouveau code
- Incluez des tests appropriés pour les nouvelles fonctionnalités
- Mettez à jour la documentation pour tous les changements visibles par l'utilisateur

### Directives de Commit

- Rédigez des messages de commit clairs et concis
- Référencez les numéros d'issue lorsque applicable
- Gardez les commits concentrés sur un seul changement

### Tester Vos Changements

- Exécutez la suite de tests :
    ```bash
    npm test
    ```
- Testez manuellement vos changements dans l'extension de développement

### Créer une Pull Request

1. Poussez vos changements vers votre fork :

    ```bash
    git push origin your-branch-name
    ```

2. Allez au [dépôt Kilo Code](https://github.com/Kilo-Org/kilocode)

3. Cliquez sur "New Pull Request" et sélectionnez "compare across forks"

4. Sélectionnez votre fork et votre branche

5. Remplissez le modèle de PR avec :
    - Une description claire des changements
    - Toutes les issues connexes
    - Les étapes de test
    - Captures d'écran (si applicable)

## Créer des Modes Personnalisés

Les modes personnalisés sont un moyen puissant d'étendre les capacités de Kilo Code. Pour créer et partager un mode personnalisé :

1. Suivez la [documentation des Modes Personnalisés](/features/custom-modes) pour créer votre mode

2. Testez votre mode minutieusement

3. Partagez votre mode avec la communauté en soumettant une [GitHub Discussion](https://github.com/Kilo-Org/kilocode/discussions)

## Contributions à la Documentation

Les améliorations de la documentation sont des contributions très appréciées :

1. Suivez le guide de style de documentation :

    - Utilisez un langage clair et concis
    - Incluez des exemples lorsque approprié
    - Utilisez des chemins absolus commençant par `/docs/` pour les liens internes
    - N'incluez pas les extensions `.md` dans les liens

2. Testez vos changements de documentation en exécutant le site de docs localement :

    ```bash
    cd docs
    npm install
    npm start
    ```

3. Soumettez une PR avec vos changements de documentation

## Directives Communautaires

Lors de la participation à la communauté Kilo Code :

- Soyez respectueux et inclusif
- Fournissez un feedback constructif
- Aidez les nouveaux à démarrer
- Suivez le [Code de Conduite](https://github.com/Kilo-Org/kilocode/blob/main/CODE_OF_CONDUCT.md)

## Obtenir de l'Aide

Si vous avez besoin d'aide pour votre contribution :

- Rejoignez notre [communauté Discord](https://kilocode.ai/discord) pour un support en temps réel
- Posez des questions sur [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions)
- Visitez notre [communauté Reddit](https://www.reddit.com/r/KiloCode)

## Reconnaissance

Tous les contributeurs sont des membres appréciés de la communauté Kilo Code. Les contributeurs sont reconnus dans :

- Les notes de version
- Le README du projet
- La liste des contributeurs sur GitHub

Merci de contribuer à Kilo Code et d'aider à rendre l'assistance de codage basée sur l'IA meilleure pour tous !
