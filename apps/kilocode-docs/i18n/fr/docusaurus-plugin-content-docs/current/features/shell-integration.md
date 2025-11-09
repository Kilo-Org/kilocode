# Intégration Shell de Terminal

L'Intégration Shell de Terminal est une fonctionnalité clé qui permet à Kilo Code d'exécuter des commandes dans votre terminal et de traiter intelligemment leur sortie. Cette communication bidirectionnelle entre l'IA et votre environnement de développement débloque de puissantes capacités d'automatisation.

## Qu'est-ce que l'Intégration Shell ?

L'intégration shell est automatiquement activée dans Kilo Code et se connecte directement au cycle de vie d'exécution de commande de votre terminal sans nécessiter aucune configuration de votre part. Cette fonctionnalité intégrée permet à Kilo Code de :

- Exécuter des commandes en votre nom à travers l'outil [`execute_command`](/features/tools/execute-command)
- Lire la sortie de commande en temps réel sans copier-coller manuel
- Détecter et corriger automatiquement les erreurs dans les applications en cours d'exécution
- Observer les codes de sortie de commande pour déterminer le succès ou l'échec
- Suivre les changements de répertoire de travail quand vous naviguez dans votre projet
- Réagir intelligemment à la sortie terminal sans intervention utilisateur

Quand Kilo Code a besoin d'effectuer des tâches comme installer les dépendances, démarrer un serveur de développement, ou analyser les erreurs de build, l'intégration shell travaille en arrière-plan pour rendre ces interactions fluides et efficaces.

## Commencer avec l'Intégration Shell

L'intégration shell est intégrée dans Kilo Code et fonctionne automatiquement dans la plupart des cas. Si vous voyez des messages "Intégration Shell Indisponible" ou rencontrez des problèmes avec l'exécution de commande, essayez ces solutions :

1. **Mettre à jour VSCode/Cursor** à la dernière version (VSCode 1.93+ requis)
2. **Assurez-vous qu'un shell compatible est sélectionné** : Palette de Commandes (`Ctrl+Shift+P` ou `Cmd+Shift+P`) → "Terminal : Sélectionner le Profil par Défaut" → Choisissez bash, zsh, PowerShell, ou fish
3. **Utilisateurs Windows PowerShell** : Exécutez `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` puis redémarrez VSCode
4. **Utilisateurs WSL** : Ajoutez `. "$(code --locate-shell-integration-path bash)"` à votre `~/.bashrc`

## Paramètres d'Intégration Terminal

Kilo Code fournit plusieurs paramètres pour affiner l'intégration shell. Accédez-y dans la barre latérale Kilo Code sous Paramètres → Terminal.

### Paramètres de Base

#### Limite de Sortie Terminal

<img src="/docs/img/shell-integration/terminal-output-limit.png" alt="Curseur de limite de sortie terminal réglé sur 500" width="500" />
Contrôle le nombre maximum de lignes capturées depuis la sortie terminal. Quand dépassée, il garde 20% du début et 80% de la fin avec un message de troncature entre les deux. Cela empêche l'utilisation excessive de tokens tout en maintenant le contexte. Par défaut : 500 lignes.
Contrôle le nombre maximum de lignes capturées depuis la sortie terminal. Quand dépassée, les lignes sont supprimées du milieu pour économiser des tokens. Par défaut : 500 lignes.

#### Timeout d'Intégration Shell Terminal

<img src="/docs/img/shell-integration/shell-integration-timeout.png" alt="Curseur de timeout d'intégration shell terminal réglé sur 15s" width="500" />

Temps maximum d'attente pour l'initialisation de l'intégration shell avant d'exécuter les commandes. Augmentez cette valeur si vous rencontrez des erreurs "Intégration Shell Indisponible". Par défaut : 15 secondes.

#### Délai de Commande Terminal

<img src="/docs/img/shell-integration/terminal-command-delay.png" alt="Curseur de délai de commande terminal réglé sur 0ms" width="500" />

Ajoute une petite pause après l'exécution des commandes pour aider Kilo Code à capturer correctement toute la sortie. Ce paramètre peut impacter significativement la fiabilité de l'intégration shell en raison de l'implémentation de l'intégration terminal de VSCode à travers différents systèmes d'exploitation et configurations shell :

- **Par Défaut** : 0ms
- **Valeurs Communes** :
    - 0ms : Fonctionne mieux pour certains utilisateurs avec des versions VSCode plus récentes
    - 50ms : Valeur par défaut historique, encore efficace pour beaucoup d'utilisateurs
    - 150ms : Recommandé pour les utilisateurs PowerShell
- **Note** : Différentes valeurs peuvent mieux fonctionner selon votre :
    - Version VSCode
    - Personnalisations shell (oh-my-zsh, powerlevel10k, etc.)
    - Système d'exploitation et environnement

### Paramètres Avancés

:::info Important
**Redémarrage de terminal requis pour ces paramètres**

Les changements aux paramètres de terminal avancés ne prennent effet qu'après le redémarrage de vos terminaux. Pour redémarrer un terminal :

1. Cliquez sur l'icône de poubelle dans le panneau terminal pour fermer le terminal actuel
2. Ouvrez un nouveau terminal avec Terminal → Nouveau Terminal ou <kbd>Ctrl</kbd>+<kbd>`</kbd> (backtick)

Redémarrez toujours tous les terminaux ouverts après avoir changé n'importe lequel de ces paramètres.
:::

#### Contournement de Compteur PowerShell

<img src="/docs/img/shell-integration/power-shell-workaround.png" alt="Case à cocher de contournement de compteur PowerShell" width="600" />

Aide PowerShell à exécuter la même commande plusieurs fois de suite. Activez cela si vous remarquez que Kilo Code ne peut pas exécuter des commandes identiques consécutivement dans PowerShell.

#### Effacer la Marque EOL ZSH

<img src="/docs/img/shell-integration/clear-zsh-eol-mark.png" alt="Case à cocher Effacer la marque EOL ZSH" width="600" />

Empêche ZSH d'ajouter des caractères spéciaux à la fin des lignes de sortie qui peuvent confondre Kilo Code lors de la lecture des résultats terminaux.

#### Intégration Oh My Zsh

<img src="/docs/img/shell-integration/oh-my-zsh.png" alt="Case à cocher Activer l'intégration Oh My Zsh" width="600" />

Fait que Kilo Code fonctionne mieux avec le populaire framework de personnalisation shell [Oh My Zsh](https://ohmyz.sh/). Activez cela si vous utilisez Oh My Zsh et rencontrez des problèmes terminaux.

#### Intégration Powerlevel10k

<img src="/docs/img/shell-integration/power10k.png" alt="Case à cocher Activer l'intégration Powerlevel10k" width="600" />

Améliore la compatibilité si vous utilisez le thème Powerlevel10k pour ZSH. Activez cela si votre prompt terminal fancy cause des problèmes avec Kilo Code.

#### Gestion ZDOTDIR

<img src="/docs/img/shell-integration/zdotdir.png" alt="Case à cocher Activer la gestion ZDOTDIR" width="600" />

Aide Kilo Code à fonctionner avec les configurations ZSH personnalisées sans interférer avec vos paramètres shell personnels et personnalisations.

## Dépanner l'Intégration Shell

### Politique d'Exécution PowerShell (Windows)

PowerShell restreint l'exécution de script par défaut. Pour configurer :

1. Ouvrez PowerShell en tant qu'Administrateur
2. Vérifiez la politique actuelle : `Get-ExecutionPolicy`
3. Définissez la politique appropriée : `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

Politiques communes :

- `Restricted` : Aucun script autorisé (par défaut)
- `RemoteSigned` : Les scripts locaux peuvent s'exécuter ; les scripts téléchargés ont besoin d'être signés
- `Unrestricted` : Tous les scripts s'exécutent avec des avertissements
- `AllSigned` : Tous les scripts doivent être signés

### Installation Manuelle d'Intégration Shell

Si l'intégration automatique échoue, ajoutez la ligne appropriée à votre configuration shell :

**Bash** (`~/.bashrc`) :

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path bash)"
```

**Zsh** (`~/.zshrc`) :

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"
```

**PowerShell** (`$Profile`) :

```powershell
if ($env:TERM_PROGRAM -eq "vscode") { . "$(code --locate-shell-integration-path pwsh)" }
```

**Fish** (`~/.config/fish/config.fish`) :

```fish
string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)
```

### Problèmes de Personnalisation Terminal

Si vous utilisez des outils de personnalisation terminal :

**Powerlevel10k** :

```bash
# Ajoutez avant de sourcer powerlevel10k dans ~/.zshrc
typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
```

**Alternative** : Activez le paramètre Intégration Powerlevel10k dans Kilo Code.

### Vérifier le Statut d'Intégration Shell

Confirmez que l'intégration shell est active avec ces commandes :

**Bash** :

```bash
set | grep -i '[16]33;'
echo "$PROMPT_COMMAND" | grep vsc
trap -p DEBUG | grep vsc
```

**Zsh** :

```zsh
functions | grep -i vsc
typeset -p precmd_functions preexec_functions
```

**PowerShell** :

```powershell
Get-Command -Name "*VSC*" -CommandType Function
Get-Content Function:\Prompt | Select-String "VSCode"
```

**Fish** :

```fish
functions | grep -i vsc
functions fish_prompt | grep -i vsc
```

Indicateurs visuels d'intégration shell active :

1. Indicateur d'intégration shell dans la barre de titre du terminal
2. Surlignage de détection de commande
3. Mises à jour de répertoire de travail dans le titre terminal
4. Rapport de durée de commande et code de sortie

## Méthodes d'Intégration Terminal WSL

Quand vous utilisez le Sous-système Windows pour Linux (WSL), il y a deux façons distinctes d'utiliser VSCode avec WSL, chacune avec des implications différentes pour l'intégration shell :

### Méthode 1 : VSCode Windows avec Terminal WSL

Dans cette configuration :

- VSCode s'exécute nativement dans Windows
- Vous utilisez la fonctionnalité d'intégration terminal WSL dans VSCode
- Les commandes shell sont exécutées à travers le pont WSL
- Peut expérimenter une latence additionnelle due à la communication Windows-WSL
- Les marqueurs d'intégration shell peuvent être affectés par la limite WSL-Windows : vous devez vous assurer que `source "$(code --locate-shell-integration-path <shell>)"` est chargé pour votre shell dans l'environnement WSL car il peut ne pas se charger automatiquement ; voir ci-dessus.

### Méthode 2 : VSCode S'exécutant dans WSL

Dans cette configuration :

- Vous lancez VSCode directement depuis WSL en utilisant `code .`
- Le serveur VSCode s'exécute nativement dans l'environnement Linux
- Accès direct au système de fichiers et outils Linux
- Meilleures performances et fiabilité pour l'intégration shell
- L'intégration shell se charge automatiquement puisque VSCode s'exécute nativement dans l'environnement Linux
- Approche recommandée pour le développement WSL

Pour une intégration shell optimale avec WSL, nous recommandons :

1. Ouvrez votre distribution WSL
2. Naviguez vers votre répertoire de projet
3. Lancez VSCode en utilisant `code .`
4. Utilisez le terminal intégré dans VSCode

## Problèmes Connus et Contournements

### Intégration Shell VS Code pour Fish + Cygwin sur Windows

Pour les utilisateurs Windows qui utilisent le terminal Fish dans un environnement Cygwin, voici comment l'intégration shell de VS Code fonctionne :

1.  **(Optionnel) Localiser le Script d'Intégration Shell :**
    Ouvrez votre terminal Fish _dans VS Code_ et exécutez la commande suivante :

    ```bash
    code --locate-shell-integration-path fish
    ```

    Cela affichera le chemin vers le script `shellIntegration.fish`. Notez ce chemin.

2.  **Mettez à Jour votre Configuration Fish :**
    Éditez votre fichier `config.fish` (habituellement located à `~/.config/fish/config.fish` dans votre répertoire personnel Cygwin). Ajoutez la ligne suivante, préférence dans un bloc `if status is-interactive` ou à la fin très du fichier :

    ```fish
    # Exemple de structure config.fish
    if status is-interactive
        # Vos autres configurations shell interactives...
        # localiser automatiquement le script d'intégration :
        string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)

        # Ou si ce qui précède échoue pour vous :
        # Sourcez le script d'intégration shell VS Code
        # IMPORTANT : Remplacez le chemin d'exemple ci-dessous avec le chemin réel que vous avez trouvé à l'Étape 1.
        # Assurez-vous que le chemin est dans un format que Cygwin peut comprendre (ex. en utilisant /cygdrive/c/...).
        # source "/cygdrive/c/Users/YourUser/.vscode/extensions/..../shellIntegration.fish"
    end
    ```

    _Rappelez-vous de remplacer le chemin d'exemple avec le chemin réel de l'Étape 1, correctement formaté pour Cygwin._

3.  **Configurez le Profil Terminal VS Code :**
    Ouvrez votre fichier `settings.json` VS Code (Ctrl+Shift+P -> "Préférences : Ouvrir les Paramètres Utilisateur (JSON)"). Mettez à jour ou ajoutez le profil Fish sous `terminal.integrated.profiles.windows` comme ceci :

    ```json
    {
      // ... autres paramètres ...

      "terminal.integrated.profiles.windows": {
        // ... autres profils ...

        // Recommandé : Utilisez bash.exe pour lancer fish comme un shell de login
        "fish": {
          "path": "C:\\cygwin64\\bin\\bash.exe", // Ou votre chemin bash Cygwin
          "args": [
            "--login", // S'assure que les scripts de login s'exécutent (important pour l'environnement Cygwin)
            "-i",      // S'assure que bash s'exécute interactivement
            "-c",
            "exec fish" // Remplace le processus bash par fish
          ],
          "icon": "terminal-bash" // Optionnel : Utilisez une icône reconnaissable
        }
        // Alternative (si ce qui précède échoue) : Lancez fish directement
        "fish-direct": {
          "path": "C:\\cygwin64\\bin\\fish.exe", // Assurez-vous que c'est dans votre PATH Windows ou fournissez le chemin complet
          // Utilisez 'options' ici au lieu de 'args' ; sinon, vous pourriez rencontrer l'erreur "terminal process terminated exit code 1".
          "options": ["-l", "-c"], // Exemple : drapeaux de login et interactif.
          "icon": "terminal-fish" // Optionnel : Utilisez une icône fish
        }
      },

      // Optionnel : Définissez fish comme votre par défaut si désiré
      // "terminal.integrated.defaultProfile.windows": "fish", // ou "fish-direct" selon ce que vous utilisez.

      // ... autres paramètres ...
    }
    ```

    _Note : Utiliser `bash.exe --login -i -c "exec fish"` est souvent plus fiable dans les environnements Cygwin pour assurer la configuration d'environnement correcte avant que `fish` démarre. Cependant, si cette approche ne fonctionne pas, essayez la configuration de profil `fish-direct`._

4.  **Redémarrez VS Code :**
    Fermez et rouvrez complètement Visual Studio Code pour appliquer les changements.

5.  **Vérifiez :**
    Ouvrez un nouveau terminal Fish dans VS Code. Les fonctionnalités d'intégration shell (comme les décorations de commande, meilleure navigation d'historique de commande, etc.) devraient maintenant être actives. Vous pouvez tester la fonctionnalité de base en exécutant des commandes simples comme `echo "Hello from integrated Fish!"`. <img src="/img/shell-integration/shell-integration-8.png" alt="Exemple d'Intégration Fish Cygwin" width="600" />

Cette configuration fonctionne de manière fiable sur les systèmes Windows utilisant Cygwin, Fish, et le prompt Starship, et devrait assister les utilisateurs avec des configurations similaires.

### Échecs d'Intégration Shell Après VSCode 1.98

**Problème** : Après les mises à jour VSCode au-delà de la version 1.98, l'intégration shell peut échouer avec l'erreur "VSCE output start escape sequence (]633;C or ]133;C) not received".

**Solutions** :

1. **Définir le Délai de Commande Terminal** :

    - Réglez le Délai de Commande Terminal à 50ms dans les paramètres Kilo Code
    - Redémarrez tous les terminaux après avoir changé ce paramètre
    - Cela correspond au comportement par défaut plus ancien et peut résoudre le problème, cependant certains utilisateurs ont rapporté qu'une valeur de 0ms fonctionne mieux. C'est un contournement pour les problèmes VSCode amont.

2. **Rétrograder la Version VSCode** :

    - Téléchargez VSCode v1.98 depuis [Mises à Jour VSCode](https://code.visualstudio.com/updates/v1_98)
    - Remplacez votre installation VSCode actuelle
    - Aucune sauvegarde des paramètres Kilo nécessaire

3. **Contournement Spécifique WSL** :

    - Si vous utilisez WSL, assurez-vous de lancer VSCode depuis WSL en utilisant `code .`

4. **Utilisateurs ZSH** :
    - Essayez d'activer certains ou tous les contournements liés à ZSH dans les paramètres Kilo Code
    - Ces paramètres peuvent aider indépendamment de votre système d'exploitation

## Problèmes Connus et Contournements

### Comportement Ctrl+C

**Problème** : Si du texte est déjà tapé dans le terminal quand Kilo Code essaie d'exécuter une commande, Kilo Code appuiera d'abord sur Ctrl+C pour effacer la ligne, ce qui peut interrompre les processus en cours.

**Contournement** : Assurez-vous que votre prompt terminal est vide (aucune commande partielle tapée) avant de demander à Kilo Code d'exécuter des commandes terminal.

### Problèmes de Commande Multi-lignes

**Problème** : Les commandes qui s'étendent sur plusieurs lignes peuvent confondre Kilo Code et peuvent montrer la sortie des commandes précédentes mélangée avec la sortie actuelle.

**Contournement** : Au lieu de commandes multi-lignes, utilisez l'enchaînement de commandes avec `&&` pour tout garder sur une ligne (ex. `echo a && echo b` au lieu de taper chaque commande sur une ligne séparée.

### Problèmes Spécifiques PowerShell

1. **Achèvement Prématuré** : PowerShell dit parfois à Kilo Code qu'une commande est terminée avant que toute la sortie ait été montrée.
2. **Commandes Répétées** : PowerShell peut refuser d'exécuter la même commande deux fois de suite.

**Contournement** : Activez le paramètre "contournement de compteur PowerShell" et définissez un délai de commande terminal de 150ms dans les paramètres pour donner plus de temps aux commandes pour se compléter.

### Sortie Terminal Incomplète

**Problème** : Parfois VS Code ne montre ou ne capture pas toute la sortie d'une commande.

**Contournement** : Si vous remarquez une sortie manquante, essayez de fermer et rouvrir l'onglet terminal, puis exécutez la commande à nouveau. Cela rafraîchit la connexion terminal.

## Ressources de Dépannage

### Vérifier les Journaux de Débogage

Quand des problèmes d'intégration shell surviennent, vérifiez les journaux de débogage :

1. Ouvrez Aide → Basculer les Outils Développeur → Console
2. Définissez "Montrer Tous les Niveaux" pour voir tous les messages de journal
3. Cherchez les messages contenant `[Terminal Process]`
4. Vérifiez le contenu `preOutput` dans les messages d'erreur :
    - `preOutput` vide (`''`) signifie que VSCode n'a envoyé aucune donnée
    - Cela indique un problème potentiel d'intégration shell VSCode, ou un bogue amont qui est hors de notre contrôle
    - L'absence de marqueurs d'intégration shell peut nécessiter d'ajuster les paramètres pour contourner les bogues amont possibles ou les problèmes de configuration de station de travail local liés à l'initialisation shell et au chargement par VSCode des hooks spéciaux d'intégration shell

### Utiliser l'Extension de Test d'Intégration Terminal VSCode

L'[Extension de Test d'Intégration Terminal VSCode](https://github.com/KJ7LNW/vsce-test-terminal-integration) aide à diagnostiquer les problèmes d'intégration shell en testant différentes combinaisons de paramètres :

1. **Quand les Commandes Bloquent** :

    - Si vous voyez des avertissements "command already running", cliquez "Reset Stats" pour réinitialiser l'état terminal
    - Ces avertissements indiquent que l'intégration shell ne fonctionne pas
    - Essayez différentes combinaisons de paramètres jusqu'à en trouver une qui fonctionne
    - Si cela se bloque vraiment, redémarrez l'extension en fermant la fenêtre et en appuyant sur F5

2. **Test de Paramètres** :

    - Essayez systématiquement différentes combinaisons de :
        - Délai de Commande Terminal
        - Paramètres d'Intégration Shell
    - Documentez quelles combinaisons réussissent ou échouent
    - Cela aide à identifier les motifs dans les problèmes d'intégration shell

3. **Signaler les Problèmes** :
    - Une fois que vous trouvez une configuration problématique
    - Documentez la combinaison exacte de paramètres
    - Notez votre environnement (OS, version VSCode, shell, et toute personnalisation de prompt shell)
    - Ouvrez une issue avec ces détails pour aider à améliorer l'intégration shell

## Support

Si vous avez suivi ces étapes et rencontrez encore des problèmes, veuillez :

1. Vérifier les [Issues GitHub Kilo Code](https://github.com/Kilo-Org/kilocode/issues) pour voir si d'autres ont signalé des problèmes similaires
2. Si non, créer une nouvelle issue avec des détails sur votre système d'exploitation, version VSCode/Cursor, et les étapes que vous avez essayées

Pour une aide additionnelle, rejoignez notre [Discord](https://kilocode.ai/discord).
