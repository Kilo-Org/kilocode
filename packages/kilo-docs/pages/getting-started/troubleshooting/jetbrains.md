---
title: "JetBrains Troubleshooting"
description: "Common issues and solutions when running Kilo Code in JetBrains IDEs"
---

# JetBrains Troubleshooting

This page covers common issues when running Kilo Code in JetBrains IDEs (IntelliJ IDEA, WebStorm, PyCharm, PhpStorm, Rider, etc.) and how to resolve them.

## Cascade not visible

If Cascade isn't rendering, you may see errors such as:

- `JCEF is not supported in this environment or failed to initialize`
- `Internal JCEF not supported, trying external JCEF`

Cascade depends on **JCEF (JetBrains Chromium Embedded Framework)** to display its interface.

### Resolution

1. Go to **Help → Find Action → Choose Boot Java Runtime**
2. Select a runtime that includes **JCEF**
3. If JCEF is already bundled, confirm it's enabled:
   Open **Help → Edit Custom Properties** and add:
   ```
   ide.browser.jcef.enabled=true
   ```
4. Restart your IDE

## TLS / Certificate errors

You might encounter errors like:

- `Failed to fetch extension base URL`
- `PKIX path building failed`
- `unable to find valid certification path to requested target`

These indicate the IDE cannot validate the TLS certificate used by your **Kilo Code endpoint or a network proxy**.

### Typical causes

- Root certificate not trusted locally
- Corporate proxy intercepting HTTPS traffic
- Missing intermediate certificates

### Recommended fix

- Install the **root certificate** in your OS trust store
- Ensure the **complete certificate chain** is presented by the server
- If managed internally, contact your IT/admin team

JetBrains IDEs rely on the **system certificate store**, so resolving trust at the OS level usually fixes the issue.

### JetBrains 2024.3 note

Some builds may fail to recognize OS certificates. Workarounds:

- Downgrade to a previous version
- Upgrade to **2024.3.1 or later**
- Add this JVM option:
  ```
  -Djavax.net.ssl.trustStoreType=Windows-ROOT
  ```

## Custom workspace required

If you see:

> `Cascade cannot access paths without an active workspace`

Kilo Code requires an explicit workspace configuration to access project files.

### Resolution

1. Open **Settings / Preferences**
2. Navigate to **Tools → Kilo Code**
3. Locate **Custom Workspaces**
4. Click **Add Workspace**
5. Select your project folder
6. Apply changes and restart the IDE

## Still having issues?

If these steps don't resolve your problem:

- [Capture console logs](/docs/getting-started/troubleshooting/troubleshooting-extension) and share them with support
- Report the issue on [GitHub](https://github.com/Kilo-Org/kilocode/issues) or [Discord](https://kilo.ai/discord)
