Kilo Code v7 for JetBrains is officially available. It uses a native JetBrains interface, works well in [remote development split mode](https://www.jetbrains.com/remote-development/), and does not require Node.js.

The JetBrains plugin provides the best native JetBrains UX for working with an AI coding agent, and it improves with every release. Enable automatic plugin updates to get the latest fixes and improvements as soon as they are available.

### Install the JetBrains plugin

1. Open IntelliJ IDEA or another [JetBrains IDE](https://www.jetbrains.com/ides/)
2. Go to **Settings → Plugins**
3. Search for **Kilo Code** in the **Marketplace** tab
4. Click **Install** or **Update** and restart your IDE if prompted
5. Open **Settings → Appearance & Behavior → System Settings → Updates**, then enable **Update plugins automatically** (recommended)

{% image src="/docs/img/jetbrains/plugin-marketplace.png" alt="JetBrains Plugins Marketplace showing the Kilo Code plugin search result" width="900" caption="Search for Kilo Code in the JetBrains Plugins Marketplace." /%}

{% image src="/docs/img/jetbrains/plugin-auto-updates.png" alt="JetBrains Updates settings with Update plugins automatically enabled" width="900" caption="Enable automatic plugin updates to receive Kilo Code fixes and improvements." /%}

### If you used the v7 EAP {% #jetbrains-early-access %}

{% callout type="info" %}
Remove the EAP repository URL from **Settings → Plugins → Manage Plugin Repositories**. The official v7 plugin is now available from the default JetBrains Marketplace channel, and leaving the custom repository configured can keep your IDE on EAP updates.
{% /callout %}

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
