---
title: "Checkpoints"
description: "Save and restore code states with checkpoints"
---

# Checkpoints

Checkpoints automatically version your workspace files during Kilo Code tasks, enabling non-destructive exploration of AI suggestions and easy recovery from unwanted changes.

Checkpoints let you:

- Safely experiment with AI-suggested changes
- Easily recover from undesired modifications
- Compare different implementation approaches
- Revert to previous project states without losing work

## Configuration Options

{% tabs %}
{% tab label="VSCode" %}

Checkpoints (called **snapshots** in the new extension) are enabled by default. They are configured via the `snapshot` key in your config file (`kilo.jsonc` or `~/.config/kilo/kilo.jsonc`):

```json
{
  "snapshot": true
}
```

You can also toggle this in Settings:

1. Open Settings by clicking the gear icon {% codicon name="gear" /%}
2. Go to the **Checkpoints** tab
3. Toggle the snapshot setting on or off

{% callout type="info" %}
Unlike the legacy extension which used a separate shadow Git repository, the new extension uses a dedicated snapshot Git repository stored outside your project. Your project's `.git` history is never modified by the snapshot system.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

Checkpoints are controlled by the `snapshot` boolean in your `kilo.jsonc` configuration file:

```json
{
  "snapshot": true
}
```

When enabled, the system automatically captures snapshots at each step of a task.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Access checkpoint settings in Kilo Code settings under the "Checkpoints" section:

1. Open Settings by clicking the gear icon {% codicon name="gear" /%} → Checkpoints
2. Check or uncheck the "Enable automatic checkpoints" checkbox

   {% image src="/docs/img/checkpoints/checkpoints.png" alt="Checkpoint settings in Kilo Code configuration" width="500" /%}

{% /tab %}
{% /tabs %}

## How Checkpoints Work

{% tabs %}
{% tab label="VSCode" %}

The new extension uses **git-based snapshots** to track your workspace state. A dedicated Git repository (with a detached work tree pointing at your project) is created outside your project directory to store snapshot data — your project's own `.git` history is never touched.

Snapshots are captured automatically at the boundaries of each model call within an agent turn:

1. **Before** the model starts generating (step start)
2. **After** the model finishes and its tool calls have been executed (step finish)

A single user message can produce **multiple steps**. For example, if the agent edits a file, runs a command, sees the output, and then edits another file, each model call in that sequence gets its own snapshot pair. The system records which files changed in each step.

However, while snapshots are taken at each step boundary, **the revert UI operates at the user message level**. You can only revert to the point just before a user message was sent — you cannot revert to an intermediate step within a single agent response.

{% callout type="warning" %}
Revert granularity is **per user message**, not per individual step or file edit. If the agent makes changes across multiple steps within a single response, reverting will undo all of those changes at once.
{% /callout %}

{% callout type="info" %}
Snapshots respect your `.gitignore` rules. Files ignored by Git (such as `node_modules/`, `dist/`, or `.env`) are excluded from snapshots.
{% /callout %}

{% /tab %}
{% tab label="VSCode (Legacy)" %}

{% callout type="info" title="Important Notes" %}

- **Checkpoints are enabled by default.**
- **Git must be installed** for checkpoints to function - [see installation instructions](#git-installation)
- The working directory must be a Git repository for checkpoints to work
- No GitHub account or repository is required
- No Git personal information configuration is needed
- The shadow Git repository operates independently from your project's existing Git configuration

{% /callout %}

Kilo Code captures snapshots of your project's state using a shadow Git repository, separate from your main version control system. These snapshots, called checkpoints, automatically record changes throughout your AI-assisted workflow—whenever tasks begin, files change, or commands run.

Checkpoints are stored as Git commits in the shadow repository, capturing:

- File content changes
- New files added
- Deleted files
- Renamed files
- Binary file changes

{% /tab %}
{% /tabs %}

## Working with Checkpoints

{% tabs %}
{% tab label="VSCode" %}

Checkpoints are integrated directly into your chat interface. Each agent turn that modified files shows a collapsible diff summary listing the changed files with addition/deletion counts.

### Viewing Changes

Click the diff summary on any agent turn to expand it and see which files were modified. Click an individual file to open a side-by-side diff in the VS Code editor.

### Reverting with "Revert to here"

Every user message in the chat that has a corresponding agent response shows a **Revert to here** button (a left-arrow icon) when you hover over it:

{% image src="/docs/img/checkpoints/revert-to-here-button.png" alt="Revert to here button shown on hover over a user message" width="350" /%}

The revert button appears on **user messages only** — these are the revert points in the conversation. You revert to the state your workspace was in just before a given user message was sent. There is no way to revert to a point partway through an agent response.

Clicking **Revert to here** does two things:

1. **Restores your workspace files** to the state they were in just before that message was sent
2. **Hides all subsequent messages** in the chat so you see the conversation as it was at that point

The button is only active when the agent is idle. While the agent is running, the button is disabled to prevent reverting mid-operation.

### The Revert Banner

After reverting, a **Revert Banner** appears at the bottom of the chat. The banner shows:

- The number of messages that were reverted (e.g. "1 message reverted" or "3 messages reverted")
- A per-file breakdown of the changes that were undone, with addition/deletion counts
- A hint: "Send a new message to make this permanent"

The banner provides two actions:

- **Redo** — Steps forward one message at a time, re-applying changes from the next reverted message
- **Redo All** — Restores the workspace to the latest state and un-hides all messages (only shown when more than one message is reverted)

### Making a Revert Permanent

While in a reverted state, you have two choices:

- **Redo / Redo All** to return to where you were
- **Send a new message** to branch off from the reverted point. When you send a new message while reverted, the reverted messages are permanently deleted from the session and the agent continues from the restored state. This is how you "undo" the agent's work and try a different approach.

{% callout type="tip" %}
Reverting is non-destructive until you send a new message. You can freely revert and redo to compare different states of your code without losing anything.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

Checkpoints are captured automatically at each step of a task. In the CLI terminal interface, checkpoints appear as revert points in the conversation. You can revert to any point by selecting the corresponding message.

### Reverting Changes

- **Full revert**: Revert your workspace to any point in the conversation
- **Undo a revert**: Restore the state before the last revert
- **Per-file revert**: Selectively undo changes to specific files while keeping others

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Checkpoints are integrated directly into your workflow through the chat interface.

Checkpoints appear directly in your chat history in two forms:

- **Initial checkpoint** marks your starting project state
  {% image src="/docs/img/checkpoints/checkpoints-1.png" alt="Initial checkpoint indicator in chat" width="500" /%}

- **Regular checkpoints** appear after file modifications or command execution
  {% image src="/docs/img/checkpoints/checkpoints-2.png" alt="Regular checkpoint indicator in chat" width="500" /%}

Each checkpoint provides two primary functions:

### Viewing Differences

To compare your current workspace with a previous checkpoint:

1. Locate the checkpoint in your chat history
2. Click the checkpoint's `View Differences` button

   {% image src="/docs/img/checkpoints/checkpoints-6.png" alt="View Differences button interface" width="100" /%}

3. Review the differences in the comparison view:
   - Added lines are highlighted in green
   - Removed lines are highlighted in red
   - Modified files are listed with detailed changes
   - Renamed and moved files are tracked with their path changes
   - New or deleted files are clearly marked

{% image src="/docs/img/checkpoints/checkpoints-3.png" alt="View differences option for checkpoints" width="800" /%}

### Restoring Checkpoints

To restore a project to a previous checkpoint state:

1. Locate the checkpoint in your chat history
2. Click the checkpoint's `Restore Checkpoint` button
   {% image src="/docs/img/checkpoints/checkpoints-7.png" alt="Restore checkpoint button interface" width="100" /%}
3. Choose one of these restoration options:

   {% image src="/docs/img/checkpoints/checkpoints-4.png" alt="Restore checkpoint option" width="300" /%}
   - **Restore Files Only** - Reverts only workspace files to checkpoint state without modifying conversation history. Ideal for comparing alternative implementations while maintaining chat context, allowing you to seamlessly switch between different project states. This option does not require confirmation and lets you quickly switch between different implementations.
   - **Restore Files & Task** - Reverts both workspace files AND removes all subsequent conversation messages. Use when you want to completely reset both your code and conversation back to the checkpoint's point in time. This option requires confirmation in a dialog as it cannot be undone.

     {% image src="/docs/img/checkpoints/checkpoints-9.png" alt="Confirmation dialog for restoring checkpoint with files & task" width="300" /%}

{% /tab %}
{% /tabs %}

### Limitations and Considerations

- **Scope**: Checkpoints only capture changes made during active Kilo Code tasks
- **External changes**: Modifications made outside of tasks (manual edits, other tools) aren't included
- **Large files**: Very large binary files may impact performance
- **Unsaved work**: Restoration will overwrite any unsaved changes in your workspace

## Technical Implementation

{% tabs %}
{% tab label="VSCode" %}

### Snapshot Architecture

The snapshot system consists of:

1. **Snapshot Git Repository**: A dedicated Git repository created outside your project at `~/.local/share/kilo/snapshot/<project-id>/<worktree-hash>/`. This stores all snapshot tree objects without affecting your project's Git history. Each worktree gets its own snapshot repository, identified by a hash of the worktree path.

2. **Step-level Snapshots**: The agent runtime automatically runs `git write-tree` against your workspace before and after each agent step. The resulting tree hashes are stored alongside the conversation messages.

3. **Patch Records**: After each step, the system records which files were modified. These patch records enable targeted file-level reverts rather than full-workspace restores.

### How Revert Works

When you click "Revert to here" on a message:

1. The system collects all patch records (file change lists) from messages after the revert point
2. A snapshot of the current workspace is taken so the operation can be undone
3. For each changed file, the system checks out the version from the pre-change snapshot using the stored tree hash
4. Files that were created by the agent (and didn't exist before) are deleted
5. The session records the revert state so the UI can show the Revert Banner

When you click "Redo All" (unrevert):

1. The workspace is fully restored from the snapshot taken in step 2 above using `git checkout-index`
2. The revert state is cleared from the session

### Storage and Cleanup

Snapshot data is stored per-project and is periodically cleaned up. A background process runs `git gc --prune=7.days` every hour, which removes unreachable snapshot objects older than 7 days. Because snapshots are stored as raw tree hashes (not refs or commits), older snapshots may be pruned by garbage collection even if a session still references them.

### Worktree Isolation

When using the Agent Manager with git worktrees, each worktree gets its own isolated snapshot repository. This prevents snapshot data from one worktree interfering with another while sharing underlying Git objects for storage efficiency.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

### Checkpoint Architecture

The checkpoint system consists of:

1. **Shadow Git Repository**: A separate Git repository created specifically for checkpoint tracking that functions as the persistent storage mechanism for checkpoint state.

2. **Checkpoint Service**: Handles Git operations and state management through:
   - Repository initialization
   - Checkpoint creation and storage
   - Diff computation
   - State restoration

3. **UI Components**: Interface elements displayed in the chat that enable interaction with checkpoints.

### Restoration Process

When restoration executes, Kilo Code:

- Performs a hard reset to the specified checkpoint commit
- Copies all files from the shadow repository to your workspace
- Updates internal checkpoint tracking state

### Storage Type

Checkpoints are task-scoped, meaning they are specific to a single task.

### Diff Computation

Checkpoint comparison uses Git's underlying diff capabilities to produce structured file differences:

- Modified files show line-by-line changes
- Binary files are properly detected and handled
- Renamed and moved files are tracked correctly
- File creation and deletion are clearly identified

### File Exclusion and Ignore Patterns

The checkpoint system uses intelligent file exclusion to track only relevant files:

#### Built-in Exclusions

The system has comprehensive built-in exclusion patterns that automatically ignore:

- Build artifacts and dependency directories (`node_modules/`, `dist/`, `build/`)
- Media files and binary assets (images, videos, audio)
- Cache and temporary files (`.cache/`, `.tmp/`, `.bak`)
- Configuration files with sensitive information (`.env`)
- Large data files (archives, executables, binaries)
- Database files and logs

These patterns are written to the shadow repository's `.git/info/exclude` file during initialization.

#### .gitignore Support

The checkpoint system respects `.gitignore` patterns in your workspace:

- Files excluded by `.gitignore` won't trigger checkpoint creation
- Excluded files won't appear in checkpoint diffs
- Standard Git ignore rules apply when staging file changes

#### .kilocodeignore Behavior

The `.kilocodeignore` file (which controls AI access to files) is separate from checkpoint tracking:

- Files excluded by `.kilocodeignore` but not by `.gitignore` will still be checkpointed
- Changes to AI-inaccessible files can still be restored through checkpoints

This separation is intentional, as `.kilocodeignore` limits which files the AI can access, not which files should be tracked for version history.

#### Nested Git Repositories

Checkpoints do not support nested Git repositories. The working directory must be a single Git repository for checkpoints to function properly.

- Nested `.git` directories are not supported and checkpoints will be disabled
- Git submodules are not a workaround - each submodule will have its own `.git` directory, which is incompatible with checkpoint tracking
- If you have nested repositories, consider consolidating to a single repository

### Concurrency Control

Operations are queued to prevent concurrent Git operations that might corrupt repository state. This ensures that rapid checkpoint operations complete safely even when requested in quick succession.

{% /tab %}
{% /tabs %}

## Git Installation

Checkpoints require Git to be installed on your system.

### macOS

1. **Install with Homebrew (recommended)**:

   ```
   brew install git
   ```

2. **Alternative: Install with Xcode Command Line Tools**:

   ```
   xcode-select --install
   ```

3. **Verify installation**:
   - Open Terminal
   - Type `git --version`
   - You should see a version number like `git version 2.40.0`

### Windows

1. **Download Git for Windows**:
   - Visit https://git-scm.com/download/win
   - The download should start automatically

2. **Run the installer**:
   - Accept the license agreement
   - Choose installation location (default is recommended)
   - Select components (default options are typically sufficient)
   - Choose the default editor
   - Choose how to use Git from the command line (recommended: Git from the command line and also from 3rd-party software)
   - Configure line ending conversions (recommended: Checkout Windows-style, commit Unix-style)
   - Complete the installation

3. **Verify installation**:
   - Open Command Prompt or PowerShell
   - Type `git --version`
   - You should see a version number like `git version 2.40.0.windows.1`

### Linux

**Debian/Ubuntu**:

```
sudo apt update
sudo apt install git
```

**Fedora**:

```
sudo dnf install git
```

**Arch Linux**:

```
sudo pacman -S git
```

**Verify installation**:

- Open Terminal
- Type `git --version`
- You should see a version number
