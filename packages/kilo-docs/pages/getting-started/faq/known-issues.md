---
title: "Known Issues"
description: "Known issues and limitations of Kilo Code."
tocDepth: 2
---

# Known Issues

This section contains known issues and limitations of Kilo Code.

## VSCode

### Workflows get stuck on "API Request…" and never start

#### Symptoms

- Workflow shows "API Request…" and keeps spinning
- Usage meter stays at 0 tokens
- Canceling shows "Task file not found for task ID"
- VS Code becomes unresponsive until restart

#### Cause

In some cases, this behavior can be caused by a conflict with other VS Code extensions that interact with files or workspace scanning.

A reported example was the **Todo Tree** extension, which interfered with workflow execution. Disabling the extension resolved the issue immediately.

#### Workarounds

1. Temporarily disable recently installed VS Code extensions
2. Retry the workflow
3. Re-enable extensions one by one to identify conflicts

#### Recommendation

If you encounter similar behavior:

- Test with extensions disabled
- [Share logs](/docs/getting-started/troubleshooting/troubleshooting-extension) with support if the issue persists

We are working on documenting known extension conflicts to improve troubleshooting guidance.

### Why am I seeing a "PowerShell not recognized" error on Windows?

You may see an error like this:

```
Command failed with exit code 1: powershell (Get-CimInstance -ClassName Win32_OperatingSystem).caption
'powershell' is not recognized as an internal or external command,
operable program or batch file.
```

This error occurs when Windows cannot find the PowerShell executable. Most commonly, this happens because the `PATH` environment variable does not include the directory where PowerShell is installed.

#### How do I fix this?

**Add PowerShell to your PATH:**

1. Press `Windows + X` (or right-click the Start button) and select **System**
2. Click **Advanced system settings**
3. Select **Environment Variables**
4. Under **System variables** (or User variables), find **Path** and click **Edit**
5. Click **New** and add:
   ```
   %SYSTEMROOT%\System32\WindowsPowerShell\v1.0\
   ```
6. Click **OK** to save your changes
7. Restart your computer

#### Do I need to restart?

Yes. A restart is required for Windows to apply the updated `PATH` variable.

#### Why does this error appear in remote or container environments?

This error can also appear if a Windows-specific PowerShell command is executed in:

- Remote SSH sessions
- Containers
- WSL
- macOS or Linux environments

In these cases, PowerShell may not be available, and the command must be replaced with an OS-appropriate alternative.

#### Still having issues?

Verify that PowerShell is installed and accessible by running:

## JetBrains

### Kilo Code not visible (JCEF errors)

#### Symptoms

- Kilo Code panel doesn't render or appears blank
- Errors such as `JCEF is not supported in this environment or failed to initialize`
- `Internal JCEF not supported, trying external JCEF`

#### Cause

Kilo Code depends on **JCEF (JetBrains Chromium Embedded Framework)** to display its interface. If the bundled Java runtime doesn't include JCEF, or JCEF is disabled, the panel cannot render.

#### Resolution

1. Go to **Help → Find Action → Choose Boot Java Runtime**
2. Select a runtime that includes **JCEF**
3. If JCEF is already bundled, confirm it's enabled:
   Open **Help → Edit Custom Properties** and add:
   ```
   ide.browser.jcef.enabled=true
   ```
4. Restart your IDE

### TLS / Certificate errors

#### Symptoms

- `Failed to fetch extension base URL`
- `PKIX path building failed`
- `unable to find valid certification path to requested target`

#### Cause

The IDE cannot validate the TLS certificate used by the Kilo Code endpoint or a network proxy. Common causes include untrusted root certificates, corporate proxies intercepting HTTPS traffic, or missing intermediate certificates.

#### Resolution

- Install the **root certificate** in your OS trust store
- Ensure the **complete certificate chain** is presented by the server
- If managed internally, contact your IT/admin team

JetBrains IDEs rely on the **system certificate store**, so resolving trust at the OS level usually fixes the issue.

{% callout type="note" %}
**JetBrains 2024.3 note:** Some builds may fail to recognize OS certificates. Workarounds include downgrading to a previous version, upgrading to **2024.3.1 or later**, or adding the JVM option `-Djavax.net.ssl.trustStoreType=Windows-ROOT`.
{% /callout %}
