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

{% callout type="info" title="Important Notes" %}

- **Checkpoints are enabled by default.**
- **Git must be installed** for checkpoints to function - [see installation instructions](#git-installation)
- The working directory must be a Git repository for checkpoints to work
- No GitHub account or repository is required
- No Git personal information configuration is needed
- The shadow Git repository operates independently from your project's existing Git configuration
  {% /callout %}

## Configuration Options

Access checkpoint settings in Kilo Code settings under the "Checkpoints" section:

1. Open Settings by clicking the gear icon {% codicon name="gear" /%} → Checkpoints
2. Check or uncheck the "Enable automatic checkpoints" checkbox

    {% image src="/docs/img/checkpoints/checkpoints.png" alt="Checkpoint settings in Kilo Code configuration" width="500" /%}

## How Checkpoints Work

Kilo Code captures snapshots of your project's state using a shadow Git repository, separate from your main version control system. These snapshots, called checkpoints, automatically record changes throughout your AI-assisted workflow—whenever tasks begin, files change, or commands run.

Checkpoints are stored as Git commits in the shadow repository, capturing:

- File content changes
- New files added
- Deleted files
- Renamed files
- Binary file changes

## Working with Checkpoints

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

### Limitations and Considerations

- **Scope**: Checkpoints only capture changes made during active Kilo Code tasks
- **External changes**: Modifications made outside of tasks (manual edits, other tools) aren't included
- **Large files**: Very large binary files may impact performance
- **Unsaved work**: Restoration will overwrite any unsaved changes in your workspace

## Technical Implementation

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

## Git Installation

Checkpoints require Git to be installed on your system. The implementation uses the `simple-git` library, which relies on Git command-line tools to create and manage shadow repositories.

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
