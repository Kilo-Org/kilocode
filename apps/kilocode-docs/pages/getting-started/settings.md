---
title: "Settings"
description: "Configure Kilo Code settings and preferences"
---

# Settings

Kilo Code allows you to manage your configuration settings effectively through export, import, and reset options. These features are useful for backing up your setup, sharing configurations with others, or restoring default settings if needed.

You can find these options at the bottom of the Kilo Code settings page, accessible via the gear icon (<i class="codicon codicon-gear"></i>) in the Kilo Code chat view.

<img src="/docs/img/settings-management/settings-management.png" alt="Export, Import, and Reset buttons in Kilo Code settings" width="400" />
*Image: Export, Import, and Reset buttons.*

## Export Settings

Clicking the **Export** button saves your current Kilo Code settings to a JSON file.

- **What's Exported:** The file includes your configured API Provider Profiles and Global Settings (UI preferences, mode configurations, context settings, etc.).
- **Security Warning:** The exported JSON file contains **all** your configured API Provider Profiles and Global Settings. Crucially, this includes **API keys in plaintext**. Treat this file as highly sensitive. Do not share it publicly or with untrusted individuals, as it grants access to your API accounts.
- **Process:**
    1.  Click **Export**.
    2.  A file save dialog appears, suggesting `kilo-code-settings.json` as the filename (usually in your `~/Documents` folder).
    3.  Choose a location and save the file.

This creates a backup of your configuration or a file you can share.

## Import Settings

Clicking the **Import** button allows you to load settings from a previously exported JSON file.

- **Process:**
    1.  Click **Import**.
    2.  A file open dialog appears. Select the `kilo-code-settings.json` file (or similarly named file) you want to import.
    3.  Kilo Code reads the file, validates its contents against the expected schema, and applies the settings.
- **Merging:** Importing settings **merges** the configurations. It adds new API profiles and updates existing ones and global settings based on the file content. It does **not** delete configurations present in your current setup but missing from the imported file.
- **Validation:** Only valid settings matching the internal schema can be imported, preventing configuration errors. A success notification appears upon completion.

## Reset Settings

Clicking the **Reset** button completely clears all Kilo Code configuration data and returns the extension to its default state. This is a destructive action intended for troubleshooting or starting fresh.

- **Warning:** This action is **irreversible**. It permanently deletes all API configurations (including keys stored in secret storage), custom modes, global settings, and task history.

- **Process:**

    1.  Click the red **Reset** button.
    2.  A confirmation dialog appears, warning that the action cannot be undone.
    3.  Click "Yes" to confirm.

- **What is Reset:**

    - **API Provider Profiles:** All configurations are deleted from settings and secret storage.
    - **Global Settings:** All preferences (UI, modes, approvals, browser, etc.) are reset to defaults.
    - **Custom Modes:** All user-defined modes are deleted.
    - **Secret Storage:** All API keys and other secrets managed by Kilo Code are cleared.
    - **Task History:** The current task stack is cleared.

- **Result:** Kilo Code returns to its initial state, as if freshly installed, with default settings and no user configurations.

Use this option only if you are certain you want to remove all Kilo Code data or if instructed during troubleshooting. Consider exporting your settings first if you might want to restore them later.

## Experimental Features

{% callout type="info" %}
These features are experimental and may change in future releases. They provide advanced control over Kilo Code's behavior for specific use cases.
{% /callout %}

### Concurrent File Edits

When enabled, Kilo Code can edit multiple files in a single request. When disabled, Kilo Code must edit one file at a time.

**When to disable:**

- Working with less capable models that struggle with complex multi-file operations
- You want more granular control over file modifications
- Debugging issues with file editing behavior

**Default:** Enabled

### Power Steering

When enabled, Kilo Code will remind the model about the details of its current mode definition more frequently. This leads to stronger adherence to role definitions and custom instructions, but will use more tokens per message.

**When to enable:**

- Working with custom modes that have specific role definitions
- You need stricter adherence to custom instructions
- The model is deviating from the intended mode behavior

**Trade-off:** Increased token usage per message in exchange for better mode adherence.

**Default:** Disabled

Learn more about [Custom Modes](/docs/customize/custom-modes) and how Power Steering can improve mode behavior.
