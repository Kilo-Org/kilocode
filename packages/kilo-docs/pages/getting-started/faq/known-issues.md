---
title: "Known Issues"
description: "Known issues and limitations of Kilo Code"
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

```
where powershell
```

If PowerShell is missing or blocked, system policies or security tools may need to be reviewed.
