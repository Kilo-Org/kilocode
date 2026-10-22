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

### Install with bundled Kilo Core

The Marketplace build is best for most users. Use the bundled Kilo Core build when your IDE cannot download the Kilo Core runtime after installation, such as on locked-down corporate networks, behind strict proxy or TLS inspection, in offline development environments, or where corporate policy blocks applications from downloading executables at runtime.

The bundled build ships the JetBrains plugin with Kilo Core included. The install is larger, but first launch does not need a separate runtime download.

1. Open **Settings → Plugins**
2. Click the gear icon and choose **Manage Plugin Repositories...**
3. Click **+** and add the Kilo Code repository URL:

   ```text
   https://kilo-org.github.io/kilocode/jetbrains/updatePlugins.xml
   ```

4. Click **OK**, then install or update **Kilo Code** from **Settings → Plugins**
5. Restart the IDE if prompted

{% image src="/docs/img/jetbrains/plugin-custom-repository-menu.png" alt="JetBrains Plugins settings with Manage Plugin Repositories selected from the gear menu" width="900" caption="Open Manage Plugin Repositories from the Plugins settings gear menu." /%}

{% image src="/docs/img/jetbrains/plugin-custom-repository-url.png" alt="JetBrains Custom Plugin Repositories dialog with the Kilo Code repository URL added" width="700" caption="Add the Kilo Code custom plugin repository URL." /%}

After restart, open the **Kilo Code** tool window and choose **... → Core**. The menu footer should show **Bundled Core** with the version and architecture.

{% image src="/docs/img/jetbrains/plugin-bundled-core.png" alt="Kilo Code tool window Core menu showing Bundled Core and the current architecture" width="900" caption="Confirm that the plugin is using Bundled Core." /%}

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
