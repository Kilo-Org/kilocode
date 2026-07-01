Kilo Code's current JetBrains plugin uses a native interface and supports JetBrains remote development without requiring Node.js.

### Try the v7 Early Access Program plugin {% #jetbrains-early-access %}

The v7 EAP plugin is available for users who want to try the newest JetBrains experience before it reaches the default Marketplace channel. Follow the [v7 roadmap and release milestone](https://github.com/Kilo-Org/kilocode/milestone/1) for planned work and release progress.

{% callout type="info" %}
The v7 EAP plugin is compatible with JetBrains IDE builds 261 and later. EAP builds update frequently, so we recommend enabling automatic plugin updates in your JetBrains IDE from **Settings/Preferences → System Settings → Updates → Update plugins automatically**. Share feedback in the JetBrains channel on the [Kilo Discord](https://kilo.ai/discord).
{% /callout %}

To install the EAP build and receive updates:

1. Open IntelliJ IDEA or another JetBrains IDE
2. Go to **Settings/Preferences → Plugins**
3. Click the gear icon and choose **Manage Plugin Repositories**
4. Add this repository URL:

{% copyLine text="https://plugins.jetbrains.com/plugins/list?channel=eap&pluginId=28350" /%}

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
