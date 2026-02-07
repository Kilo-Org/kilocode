---
title: "System Notifications"
description: "Configure native OS notifications for Kilo Code"
---

# System Notifications

System notifications are native operating system notifications that appear in your system's notification center or tray. Unlike VSCode's built-in notifications that only appear within the editor, system notifications are visible even when:

- VSCode is minimized or in the background
- You're working in other applications
- Your screen is locked (depending on OS settings)
- You're away from your computer

Kilo Code uses system notifications to inform you about:

- Task completion status
- Important errors or warnings
- Long-running operation updates
- Critical system events

## Supported Operating Systems

Kilo Code's system notifications work on all major operating systems with different underlying technologies:

| Operating System | Technology                      | Requirements                                 |
| ---------------- | ------------------------------- | -------------------------------------------- |
| **macOS**        | AppleScript + terminal-notifier | Built-in support, optional enhanced features |
| **Windows**      | PowerShell + Windows Runtime    | PowerShell execution policy configuration    |
| **Linux**        | notify-send                     | libnotify package installation               |

## Platform-Specific Setup

### macOS Setup

macOS has the best built-in support for system notifications with two available methods:

#### Method 1: Built-in AppleScript (Fallback)

No additional setup required. Kilo Code uses macOS's built-in command to display notifications.

#### Method 2: Enhanced with terminal-notifier (Recommended)

For enhanced notifications with custom icons, install terminal-notifier:

```bash
# Install via Homebrew
brew install terminal-notifier

# Or install via npm
npm install -g terminal-notifier
```

**How it works:** Kilo Code first attempts to use `terminal-notifier` and automatically falls back to AppleScript if it's not installed.

### Windows Setup

Windows notifications require PowerShell execution policy configuration to work properly.

#### Step 1: Configure PowerShell Execution Policy

Open PowerShell as Administrator and run:

```powershell
# Check current execution policy
Get-ExecutionPolicy

# Set execution policy to allow local scripts
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Step 2: Verify Windows Runtime Access

Windows notifications use the `Windows.UI.Notifications` API through PowerShell. This is available on:

- ✅ Windows 10 (all versions)
- ✅ Windows 11 (all versions)
- ✅ Windows Server 2016 and later
- ❌ Windows 8.1 and earlier (limited support)

#### Execution Policy Options

| Policy         | Description                                | Security Level | Recommended             |
| -------------- | ------------------------------------------ | -------------- | ----------------------- |
| `Restricted`   | No scripts allowed (default)               | Highest        | ❌ Blocks notifications |
| `RemoteSigned` | Local scripts run, downloaded need signing | High           | ✅ **Recommended**      |
| `Unrestricted` | All scripts run with warnings              | Medium         | ⚠️ Use with caution     |
| `AllSigned`    | All scripts must be signed                 | Highest        | ❌ Too restrictive      |

### Linux Setup

Linux notifications require the `libnotify` package and `notify-send` command.

#### Ubuntu/Debian Installation

```bash
# Install libnotify
sudo apt update
sudo apt install libnotify-bin

# Verify installation
which notify-send
```

#### Red Hat/CentOS/Fedora Installation

```bash
# RHEL/CentOS
sudo yum install libnotify

# Fedora
sudo dnf install libnotify

# Verify installation
which notify-send
```

#### Arch Linux Installation

```bash
# Install libnotify
sudo pacman -S libnotify

# Verify installation
which notify-send
```

#### Desktop Environment Requirements

System notifications work best with these desktop environments:

| Desktop Environment | Support Level   | Notes                                     |
| ------------------- | --------------- | ----------------------------------------- |
| **GNOME**           | ✅ Full support | Native notification center                |
| **KDE Plasma**      | ✅ Full support | Native notification system                |
| **XFCE**            | ✅ Good support | Requires notification daemon              |
| **Unity**           | ✅ Full support | Ubuntu's notification system              |
| **i3/Sway**         | ⚠️ Limited      | Requires manual notification daemon setup |
| **Headless**        | ❌ No support   | No display server available               |

#### Notification Daemon Setup (Advanced)

For minimal window managers, you may need to start a notification daemon:

```bash
# Install and start dunst (lightweight notification daemon)
sudo apt install dunst  # Ubuntu/Debian
sudo pacman -S dunst    # Arch Linux

# Start dunst manually
dunst &

# Or add to your window manager startup script
echo "dunst &" >> ~/.xinitrc
```

## Verifying System Notifications

### Test Commands by Platform

#### macOS Test

```bash
# Test AppleScript method
osascript -e 'display notification "Test message" with title "Test Title" sound name "Tink"'

# Test terminal-notifier (if installed)
terminal-notifier -message "Test message" -title "Test Title" -sound Tink
```

#### Windows Test

```powershell
# Test PowerShell notification
$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">Test Title</text>
            <text id="2">Test message</text>
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

#### Linux Test

```bash
# Test notify-send
notify-send "Test Title" "Test message"

# Test with icon (optional)
notify-send -i dialog-information "Test Title" "Test message"
```

## Troubleshooting

### Common Issues and Solutions

#### macOS Issues

**Problem:** Notifications not appearing

- **Solution 1:** Check System Preferences → Notifications → Terminal (or VSCode) → Allow notifications
- **Solution 2:** Verify Do Not Disturb is disabled
- **Solution 3:** Test with the manual commands above
- **Solution 4:** Ensure terminal-notifier is properly installed: `brew install terminal-notifier`

#### Windows Issues

**Problem:** "Execution of scripts is disabled" error

- **Solution:** Configure PowerShell execution policy as described in setup
- **Command:** `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Problem:** Notifications not appearing in Windows 11

- **Solution 1:** Check Settings → System → Notifications → Allow notifications
- **Solution 2:** Ensure Focus Assist is not blocking notifications
- **Solution 3:** Verify Windows notification service is running

**Problem:** PowerShell script errors

- **Solution:** Update PowerShell to version 5.1 or later
- **Check version:** `$PSVersionTable.PSVersion`

#### Linux Issues

**Problem:** `notify-send: command not found`

- **Solution:** Install libnotify package for your distribution
- **Ubuntu/Debian:** `sudo apt install libnotify-bin`
- **RHEL/CentOS:** `sudo yum install libnotify`
- **Arch:** `sudo pacman -S libnotify`

**Problem:** Notifications not appearing in minimal window managers

- **Solution:** Install and configure a notification daemon like dunst
- **Install:** `sudo apt install dunst` (Ubuntu/Debian)
- **Start:** `dunst &`

**Problem:** Permission denied errors

- **Solution:** Ensure your user has access to the display server
- **Check:** `echo $DISPLAY` should return something like `:0`
