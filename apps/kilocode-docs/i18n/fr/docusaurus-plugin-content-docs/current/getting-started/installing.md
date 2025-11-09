---
sidebar_label: Installing Kilo Code
---

# Installation de Kilo Code

Kilo Code est une extension VS Code qui apporte une assistance au codage alimentée par l'IA directement à votre éditeur. Installez en utilisant l'une de ces méthodes :

- [**Marketplace VS Code (Recommandé)**](#vs-code-marketplace) - méthode la plus rapide pour les utilisateurs standards de VS Code
- [**Marketplace Cursor**](#cursor-marketplace) - méthode recommandée pour les utilisateurs de Cursor
- [**Registre Open VSX**](#open-vsx-registry) - pour les éditeurs compatibles VS Code comme VSCodium ou Windsurf
- [**Installer manuellement le fichier .vsix**](#manual-installation-from-vsix) - installation directe depuis la version GitHub

## Marketplace VS Code

:::tip

Si vous avez déjà VS Code installé : [Cliquez ici pour installer Kilo Code](vscode:extension/kilocode.Kilo-Code)

:::

alternativement, vous pouvez :

1. Ouvrir VS Code
2. Accéder aux Extensions : Cliquez sur l'icône Extensions dans la Barre latérale ou appuyez sur `Ctrl+Shift+X` (Windows/Linux) ou `Cmd+Shift+X` (macOS)
3. Rechercher "Kilo Code"
4. Sélectionner "Kilo Code" par Kilo Code et cliquer sur **Installer**
5. Recharger VS Code si demandé

Après l'installation, trouvez l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la Barre latérale pour ouvrir le panneau Kilo Code.

<img src="/docs/img/installing/installing.png" alt="Marketplace VS Code avec l'extension Kilo Code prête à installer" width="400" />
*Marketplace VS Code avec l'extension Kilo Code prête à installer*

## Marketplace Cursor

:::tip

Si vous avez déjà Cursor installé : [Cliquez ici pour installer Kilo Code](cursor:extension/kilocode.Kilo-Code)

:::

alternativement, vous pouvez :

1. Ouvrir Cursor
2. Accéder aux Extensions : Cliquez sur l'icône Extensions dans la Barre latérale ou appuyez sur `Ctrl+Shift+X` (Windows/Linux) ou `Cmd+Shift+X` (macOS)
3. Rechercher "Kilo Code"
4. Sélectionner "Kilo Code" par Kilo Code et cliquer sur **Installer**
5. Recharger Cursor si demandé

Après l'installation, trouvez l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la Barre latérale pour ouvrir le panneau Kilo Code.

## Registre Open VSX

Le [Registre Open VSX](https://open-vsx.org/) est une alternative open source à la Marketplace VS Code pour les éditeurs compatibles VS Code qui ne peuvent pas accéder à la marketplace officielle en raison de restrictions de licence.

Pour les éditeurs compatibles VS Code comme VSCodium, Gitpod, Eclipse Theia et Windsurf, vous pouvez parcourir et installer directement depuis la [page Kilo Code sur le Registre Open VSX](https://open-vsx.org/extension/kilocode/Kilo-Code).

1. Ouvrez votre éditeur
2. Accédez à la vue Extensions (icône de la Barre latérale ou `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Votre éditeur devrait être préconfiguré pour utiliser le Registre Open VSX
4. Rechercher "Kilo Code"
5. Sélectionner "Kilo Code" et cliquer sur **Installer**
6. Recharger l'éditeur si demandé

:::note
Si votre éditeur n'est pas automatiquement configuré pour le Registre Open VSX, vous devrez peut-être le définir comme votre marketplace d'extensions dans les paramètres. Consultez la documentation de votre éditeur spécifique pour obtenir des instructions.
:::

## Installation manuelle depuis VSIX

Si vous préférez télécharger et installer le fichier VSIX directement :

1. **Télécharger le fichier VSIX :**

    - Trouvez les versions officielles sur la [page des versions GitHub de Kilo Code](https://github.com/Kilo-Org/kilocode/releases)
    - Téléchargez le fichier `.vsix` depuis la [dernière version](https://github.com/Kilo-Org/kilocode/releases/latest)

2. **Installer dans VS Code :**
    - Ouvrir VS Code
    - Accéder à la vue Extensions
    - Cliquez sur le menu "..." dans la vue Extensions
    - Sélectionnez "Installer depuis VSIX..."
    - Naviguez jusqu'à et sélectionnez votre fichier `.vsix` téléchargé

<img src="/docs/img/installing/installing-2.png" alt="Boîte de dialogue Installer depuis VSIX de VS Code" width="400" />
*Installation de Kilo Code en utilisant la boîte de dialogue "Installer depuis VSIX" de VS Code*

## Dépannage

**Extension non visible**

- Redémarrez VS Code
- Vérifiez que Kilo Code est listé et activé dans les Extensions
- Essayez de désactiver et de réactiver l'extension dans les Extensions
- Vérifiez le panneau Sortie pour les erreurs (Affichage → Sortie, sélectionnez "Kilo Code")

**Problèmes d'installation**

- Assurez-vous d'une connexion internet stable
- Vérifiez la version VS Code 1.84.0 ou ultérieure
- Si la Marketplace VS Code est inaccessible, essayez la méthode du Registre Open VSX

## Obtention de support

Si vous rencontrez des problèmes non couverts ici :

- Rejoignez notre [communauté Discord](https://kilocode.ai/discord) pour un support en temps réel
- Soumettez des problèmes sur [GitHub](https://github.com/Kilo-Org/kilocode/issues)
- Visitez notre [communauté Reddit](https://www.reddit.com/r/KiloCode)
