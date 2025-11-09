# Notifications Système

Les notifications système sont des notifications de système d'exploitation natif qui apparaissent dans le centre de notification ou la barre d'état de votre système. Contrairement aux notifications intégrées de VSCode qui n'apparaissent que dans l'éditeur, les notifications système sont visibles même quand :

- VSCode est minimisé ou en arrière-plan
- Vous travaillez dans d'autres applications
- Votre écran est verrouillé (selon les paramètres OS)
- Vous êtes loin de votre ordinateur

Kilo Code utilise les notifications système pour vous informer de :

- Le statut d'achèvement de tâche
- Les erreurs importantes ou avertissements
- Les mises à jour d'opérations de longue durée
- Les événements système critiques

## Systèmes d'Exploitation Supportés

Les notifications système de Kilo Code fonctionnent sur tous les systèmes d'exploitation majeurs avec différentes technologies sous-jacentes :

| Système d'Exploitation | Technologie                     | Exigences                                                |
| ---------------------- | ------------------------------- | -------------------------------------------------------- |
| **macOS**              | AppleScript + terminal-notifier | Support intégré, fonctionnalités améliorées optionnelles |
| **Windows**            | PowerShell + Windows Runtime    | Configuration de politique d'exécution PowerShell        |
| **Linux**              | notify-send                     | Installation du package libnotify                        |

## Configuration Spécifique à la Plateforme

### Configuration macOS

macOS a le meilleur support intégré pour les notifications système avec deux méthodes disponibles :

#### Méthode 1 : AppleScript Intégré (Fallback)

Aucune configuration additionnelle requise. Kilo Code utilise la commande intégrée de macOS pour afficher les notifications.

#### Méthode 2 : Amélioré avec terminal-notifier (Recommandé)

Pour des notifications améliorées avec des icônes personnalisées, installez terminal-notifier :

```bash
# Installer via Homebrew
brew install terminal-notifier

# Ou installer via npm
npm install -g terminal-notifier
```

**Comment ça fonctionne :** Kilo Code essaie d'abord d'utiliser `terminal-notifier` et retombe automatiquement sur AppleScript s'il n'est pas installé.

### Configuration Windows

Les notifications Windows nécessitent une configuration de politique d'exécution PowerShell pour fonctionner correctement.

#### Étape 1 : Configurer la Politique d'Exécution PowerShell

Ouvrez PowerShell en tant qu'Administrateur et exécutez :

```powershell
# Vérifier la politique d'exécution actuelle
Get-ExecutionPolicy

# Définir la politique d'exécution pour permettre les scripts locaux
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Étape 2 : Vérifier l'Accès Windows Runtime

Les notifications Windows utilisent l'API `Windows.UI.Notifications` à travers PowerShell. Cela est disponible sur :

- ✅ Windows 10 (toutes les versions)
- ✅ Windows 11 (toutes les versions)
- ✅ Windows Server 2016 et plus tard
- ❌ Windows 8.1 et plus tôt (support limité)

#### Options de Politique d'Exécution

| Politique      | Description                                                              | Niveau de Sécurité | Recommandée                 |
| -------------- | ------------------------------------------------------------------------ | ------------------ | --------------------------- |
| `Restricted`   | Aucun script autorisé (par défaut)                                       | Le plus élevé      | ❌ Bloque les notifications |
| `RemoteSigned` | Les scripts locaux s'exécutent, les téléchargés ont besoin d'être signés | Élevé              | ✅ **Recommandée**          |
| `Unrestricted` | Tous les scripts s'exécutent avec avertissements                         | Moyen              | ⚠️ À utiliser avec prudence |
| `AllSigned`    | Tous les scripts doivent être signés                                     | Le plus élevé      | ❌ Trop restrictif          |

### Configuration Linux

Les notifications Linux nécessitent le package `libnotify` et la commande `notify-send`.

#### Installation Ubuntu/Debian

```bash
# Installer libnotify
sudo apt update
sudo apt install libnotify-bin

# Vérifier l'installation
which notify-send
```

#### Installation Red Hat/CentOS/Fedora

```bash
# RHEL/CentOS
sudo yum install libnotify

# Fedora
sudo dnf install libnotify

# Vérifier l'installation
which notify-send
```

#### Installation Arch Linux

```bash
# Installer libnotify
sudo pacman -S libnotify

# Vérifier l'installation
which notify-send
```

#### Exigences d'Environnement de Bureau

Les notifications système fonctionnent le mieux avec ces environnements de bureau :

| Environnement de Bureau | Niveau de Support  | Notes                                                     |
| ----------------------- | ------------------ | --------------------------------------------------------- |
| **GNOME**               | ✅ Support complet | Centre de notification natif                              |
| **KDE Plasma**          | ✅ Support complet | Système de notification natif                             |
| **XFCE**                | ✅ Bon support     | Requiert un daemon de notification                        |
| **Unity**               | ✅ Support complet | Système de notification d'Ubuntu                          |
| **i3/Sway**             | ⚠️ Limité          | Requiert configuration manuelle de daemon de notification |
| **Headless**            | ❌ Pas de support  | Aucun serveur d'affichage disponible                      |

#### Configuration de Daemon de Notification (Avancé)

Pour les gestionnaires de fenêtres minimaux, vous pourriez avoir besoin de démarrer un daemon de notification :

```bash
# Installer et démarrer dunst (daemon de notification léger)
sudo apt install dunst  # Ubuntu/Debian
sudo pacman -S dunst    # Arch Linux

# Démarrer dunst manuellement
dunst &

# Ou ajouter à votre script de démarrage de gestionnaire de fenêtres
echo "dunst &" >> ~/.xinitrc
```

## Vérifier les Notifications Système

### Commandes de Test par Plateforme

#### Test macOS

```bash
# Tester la méthode AppleScript
osascript -e 'display notification "Message de test" with title "Titre de test" sound name "Tink"'

# Tester terminal-notifier (si installé)
terminal-notifier -message "Message de test" -title "Titre de test" -sound Tink
```

#### Test Windows

```powershell
# Tester la notification PowerShell
$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">Titre de Test</text>
            <text id="2">Message de test</text>
        </binding>
    </visual>
</toast>
"@

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Test App").Show($toast)
```

#### Test Linux

```bash
# Tester notify-send
notify-send "Titre de Test" "Message de test"

# Tester avec icône (optionnel)
notify-send -i dialog-information "Titre de Test" "Message de test"
```

## Dépannage

### Problèmes Communs et Solutions

#### Problèmes macOS

**Problème :** Les notifications n'apparaissent pas

- **Solution 1 :** Vérifiez Préférences Système → Notifications → Terminal (ou VSCode) → Autoriser les notifications
- **Solution 2 :** Vérifiez que Ne Pas Déranger est désactivé
- **Solution 3 :** Testez avec les commandes manuelles ci-dessus

**Problème :** Les notifications n'apparaissent pas

- **Solution :** Assurez-vous que terminal-notifier est correctement installé : `brew install terminal-notifier`

#### Problèmes Windows

**Problème :** Erreur "L'exécution de scripts est désactivée"

- **Solution :** Configurez la politique d'exécution PowerShell comme décrit dans la configuration
- **Commande :** `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Problème :** Les notifications n'apparaissent pas dans Windows 11

- **Solution 1 :** Vérifiez Paramètres → Système → Notifications → Autoriser les notifications
- **Solution 2 :** Assurez-vous que Focus Assist ne bloque pas les notifications
- **Solution 3 :** Vérifiez que le service de notification Windows fonctionne

**Problème :** Erreurs de script PowerShell

- **Solution :** Mettez à jour PowerShell vers la version 5.1 ou plus tard
- **Vérifier la version :** `$PSVersionTable.PSVersion`

#### Problèmes Linux

**Problème :** `notify-send: command not found`

- **Solution :** Installez le package libnotify pour votre distribution
- **Ubuntu/Debian :** `sudo apt install libnotify-bin`
- **RHEL/CentOS :** `sudo yum install libnotify`
- **Arch :** `sudo pacman -S libnotify`

**Problème :** Les notifications n'apparaissent pas dans les gestionnaires de fenêtres minimaux

- **Solution :** Installez et configurez un daemon de notification comme dunst
- **Installer :** `sudo apt install dunst` (Ubuntu/Debian)
- **Démarrer :** `dunst &`

**Problème :** Erreurs de permission refusée

- **Solution :** Assurez-vous que votre utilisateur a accès au serveur d'affichage
- **Vérifier :** `echo $DISPLAY` devrait retourner quelque chose comme `:0`
