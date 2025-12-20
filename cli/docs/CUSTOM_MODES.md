# Custom Modes in Kilo Code CLI

Custom modes allow you to create specialized AI agents with specific roles, instructions, and capabilities tailored to your workflow.

## Overview

The CLI supports two types of custom modes:

1. **Global Custom Modes**: Available across all projects
2. **Project Custom Modes**: Specific to a single project workspace

## File Locations

### Global Custom Modes

**Important**: The CLI uses its own configuration directory for global custom modes, separate from the VSCode extension.

- **CLI Location**: `~/.kilocode/cli/global/settings/custom_modes.yaml`
- **VSCode Extension Location**: `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml` (macOS)

> **Note**: If you've created global custom modes in the VSCode extension, you'll need to copy them to the CLI's location for them to work in the CLI.

### Project Custom Modes

Project-level custom modes work the same way in both the CLI and VSCode extension:

- **Location**: `.kilocodemodes` (in your project root)
- **Scope**: Only available within that specific project

## Creating Custom Modes

### Global Custom Modes

1. Create the directory structure:
   ```bash
   mkdir -p ~/.kilocode/cli/global/settings
   ```

2. Create or edit `~/.kilocode/cli/global/settings/custom_modes.yaml`:
   ```yaml
   customModes:
     - slug: my-custom-mode
       name: My Custom Mode
       roleDefinition: |
         You are a specialized AI assistant focused on...
       groups:
         - read
         - edit
         - command
       customInstructions: |
         Additional instructions for this mode...
   ```

### Project Custom Modes

Create a `.kilocodemodes` file in your project root:

```yaml
customModes:
  - slug: project-specific-mode
    name: Project Specific Mode
    roleDefinition: |
      You are an AI assistant specialized for this project...
    groups:
      - read
      - edit
      - browser
      - command
      - mcp
```

## Mode Configuration

Each custom mode requires the following fields:

### Required Fields

- **slug** (string): Unique identifier for the mode (lowercase, hyphens allowed)
- **name** (string): Display name for the mode

### Optional Fields

- **roleDefinition** (string): System prompt defining the AI's role and behavior
- **groups** (array): Tool groups the mode can access. Available groups:
  - `read`: File reading operations
  - `edit`: File editing operations
  - `browser`: Browser automation
  - `command`: Command execution
  - `mcp`: MCP tool usage
- **customInstructions** (string): Additional instructions or rules for the mode

## Using Custom Modes

### Start CLI with a Custom Mode

```bash
# Use a custom mode
kilocode --mode my-custom-mode

# List available modes (including custom modes)
kilocode --mode
```

### Switch Modes During a Session

Use the `/mode` command within an active CLI session:

```
/mode my-custom-mode
```

## Migrating Global Modes from VSCode to CLI

If you've created global custom modes in the VSCode extension and want to use them in the CLI:

### macOS
```bash
# Create CLI config directory
mkdir -p ~/.kilocode/cli/global/settings

# Copy from VSCode extension to CLI
cp ~/Library/Application\ Support/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml \
   ~/.kilocode/cli/global/settings/custom_modes.yaml
```

### Linux
```bash
# Create CLI config directory
mkdir -p ~/.kilocode/cli/global/settings

# Copy from VSCode extension to CLI
cp ~/.config/Code/User/globalStorage/kilocode.kilo-code/settings/custom_modes.yaml \
   ~/.kilocode/cli/global/settings/custom_modes.yaml
```

### Windows (PowerShell)
```powershell
# Create CLI config directory
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.kilocode\cli\global\settings"

# Copy from VSCode extension to CLI
Copy-Item "$env:APPDATA\Code\User\globalStorage\kilocode.kilo-code\settings\custom_modes.yaml" `
          "$env:USERPROFILE\.kilocode\cli\global\settings\custom_modes.yaml"
```

## Example Custom Mode

Here's a complete example of a custom mode for code review:

```yaml
customModes:
  - slug: code-reviewer
    name: Code Reviewer
    roleDefinition: |
      You are an expert code reviewer with deep knowledge of software engineering best practices,
      design patterns, and common pitfalls. Your role is to:
      
      - Review code for bugs, security issues, and performance problems
      - Suggest improvements for code quality and maintainability
      - Ensure adherence to coding standards and best practices
      - Provide constructive feedback with specific examples
    groups:
      - read
      - edit
      - command
    customInstructions: |
      When reviewing code:
      1. Start with a high-level overview of the changes
      2. Identify critical issues first (security, bugs)
      3. Then address code quality and style
      4. Always explain WHY something should be changed
      5. Provide code examples for suggested improvements
      6. Be respectful and constructive in your feedback
```

## Troubleshooting

### Custom Mode Not Found

If your custom mode isn't appearing:

1. **Check file location**: Ensure the file is in the correct location
   - Global: `~/.kilocode/cli/global/settings/custom_modes.yaml`
   - Project: `.kilocodemodes` in project root

2. **Verify YAML syntax**: Use a YAML validator to check for syntax errors

3. **Check required fields**: Ensure each mode has at least `slug` and `name`

4. **Restart CLI**: Exit and restart the CLI to reload custom modes

### Mode Conflicts

If you have modes with the same slug in both global and project configurations:
- Project modes take precedence over global modes
- The project version will be used when working in that project

## Best Practices

1. **Use descriptive slugs**: Choose clear, descriptive slugs like `code-reviewer` instead of `cr`

2. **Document your modes**: Include clear roleDefinition and customInstructions

3. **Limit tool groups**: Only grant access to the tool groups the mode actually needs

4. **Version control project modes**: Commit `.kilocodemodes` to your repository so team members can use the same modes

5. **Keep global modes general**: Use global modes for general-purpose tasks that apply across projects

6. **Use project modes for specifics**: Use project modes for project-specific workflows and conventions
