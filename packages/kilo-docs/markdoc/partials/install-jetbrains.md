Kilo Code supports all JetBrains IDEs including IntelliJ IDEA, WebStorm, PyCharm, and more.

### Prerequisites

Before installing the Kilo Code plugin, ensure you have:

1. **JetBrains Toolbox (Recommended):**
   - Download from [https://www.jetbrains.com/toolbox-app/](https://www.jetbrains.com/toolbox-app/)
   - Toolbox is required for authentication callbacks to work properly
   - Without Toolbox, you'll need to manually configure API keys

2. **Node.js:**
   - Download LTS version from [https://nodejs.org/](https://nodejs.org/)

{% callout type="tip" %}
Try the [v7 Early Access Program plugin](#jetbrains-early-access) for a JetBrains-native experience that does not require Node.js or manual API key configuration.
{% /callout %}

### Install directly

1. If you don't have a JetBrains IDE installed, download one from [jetbrains.com](https://www.jetbrains.com/)
2. Then, you can click the button below to install Kilo Code directly from the JetBrains Marketplace:

[![Install Kilo Code](https://raster.shields.io/badge/Install%20Kilo%20Code-F8F674?style=for-the-badge)](https://plugins.jetbrains.com/plugin/28350-kilo-code)

### Install from JetBrains Marketplace

1. Open your JetBrains IDE
2. Go to **Settings/Preferences → Plugins**
3. Click **Marketplace** tab
4. Search for "Kilo Code"
5. Click **Install** and restart your IDE

### Try the v7 Early Access Program plugin {% #jetbrains-early-access %}

The v7 EAP plugin is available for users who want to try the newest JetBrains experience before it reaches the default Marketplace channel. It uses a JetBrains-native UI and is designed to work well with JetBrains remote development.

Follow the [v7 roadmap and release milestone](https://github.com/Kilo-Org/kilocode/milestone/1) for planned work and release progress.

{% callout type="info" %}
The v7 EAP plugin is compatible with JetBrains IDE builds 261 and later. EAP builds update frequently, so we recommend enabling automatic plugin updates in your JetBrains IDE from **Settings/Preferences → System Settings → Updates → Update plugins automatically**. Share feedback in the JetBrains channel on the [Kilo Discord](https://kilo.ai/discord).
{% /callout %}

To install the EAP build and receive updates:

1. Open IntelliJ IDEA or another JetBrains IDE
2. Go to **Settings/Preferences → Plugins**
3. Click the gear icon and choose **Manage Plugin Repositories**
4. Add this repository URL:

```text
https://plugins.jetbrains.com/plugins/list?channel=eap&pluginId=28350
```

5. Return to the **Marketplace** tab
6. Search for **Kilo Code**
7. Click **Install** or **Update** and restart your IDE if prompted

After the custom repository is added, JetBrains will offer EAP updates through the normal plugin update flow.

### Supported IDEs

- IntelliJ IDEA
- WebStorm
- PyCharm
- PhpStorm
- GoLand
- Rider
- CLion
- RubyMine
- DataGrip

{% callout type="info" %}
Both Community and Ultimate editions are supported. Some AI features may vary based on your JetBrains license.
{% /callout %}
