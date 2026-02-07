---
title: "Custom Modes"
description: "Create and configure custom modes in Kilo Code"
---

# Custom Modes

Kilo Code allows you to create **custom modes** to tailor Kilo's behavior to specific tasks or workflows. Custom modes can be either **global** (available across all projects) or **project-specific** (defined within a single project).

## Sticky Models for Efficient Workflow

Each mode—including custom ones—features **Sticky Models**. This means Kilo Code automatically remembers and selects the last model you used with a particular mode. This lets you assign different preferred models to different tasks without constant reconfiguration, as Kilo switches between models when you change modes.

## Why Use Custom Modes?

- **Specialization:** Create modes optimized for specific tasks, like "Documentation Writer," "Test Engineer," or "Refactoring Expert"
- **Safety:** Restrict a mode's access to sensitive files or commands. For example, a "Review Mode" could be limited to read-only operations
- **Experimentation:** Safely experiment with different prompts and configurations without affecting other modes
- **Team Collaboration:** Share custom modes with your team to standardize workflows

{% callout type="tip" %}
**Keep custom modes on track:** Limit the types of files that they're allowed to edit using the `fileRegex` option in the `groups` configuration. This prevents modes from accidentally modifying files outside their intended scope.
{% /callout %}

{% image src="/docs/img/custom-modes/custom-modes.png" alt="Overview of custom modes interface" width="600" caption="Overview of custom modes interface" /%}

_Kilo Code's interface for creating and managing custom modes._

## What's Included in a Custom Mode?

Custom modes are defined by several key properties. Understanding these concepts will help you tailor Kilo's behavior effectively.

| UI Field / YAML Property                       | Conceptual Description                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Slug** (`slug`)                              | A unique internal identifier for the mode. Used by Kilo Code to reference the mode, especially for associating mode-specific instruction files.                                      |
| **Name** (`name`)                              | The display name for the mode as it appears in the Kilo Code user interface. Should be human-readable and descriptive.                                                               |
| **Description** (`description`)                | A short, user-friendly summary of the mode's purpose displayed in the mode selector UI. Keep this concise and focused on what the mode does for the user.                            |
| **Role Definition** (`roleDefinition`)         | Defines the core identity and expertise of the mode. This text is placed at the beginning of the system prompt and defines Kilo's personality and behavior when this mode is active. |
| **Available Tools** (`groups`)                 | Defines the allowed toolsets and file access permissions for the mode. Corresponds to selecting which general categories of tools the mode can use.                                  |
| **When to Use** (`whenToUse`)                  | _(Optional)_ Provides guidance for Kilo's automated decision-making, particularly for mode selection and task orchestration. Used by the Orchestrator mode for task coordination.    |
| **Custom Instructions** (`customInstructions`) | _(Optional)_ Specific behavioral guidelines or rules for the mode. Added near the end of the system prompt to further refine Kilo's behavior.                                        |

{% callout type="tip" %}
**Power Steering for Better Mode Adherence**

If you find that models aren't following your custom mode's role definition or instructions closely enough, enable the [Power Steering](/docs/getting-started/settings#power-steering) experimental feature. This reminds the model about mode details more frequently, leading to stronger adherence to your custom configurations at the cost of increased token usage.
{% /callout %}

## Import/Export Modes

Easily share, back up, and template your custom modes. This feature lets you export any mode—and its associated rules—into a single, portable YAML file that you can import into any project.

### Key Features

- **Shareable Setups:** Package a mode and its rules into one file to easily share with your team
- **Easy Backups:** Save your custom mode configurations so you never lose them
- **Project Templates:** Create standardized mode templates for different types of projects
- **Simple Migration:** Move modes between your global settings and specific projects effortlessly
- **Flexible Slug Changes:** Change mode slugs in exported files without manual path editing

### How it Works

**Exporting a Mode:**

Modes are accessed from the Prompts tab (notebook icon), which contains the Modes section.

1. Open the Prompts Tab (click the <Codicon name="notebook" /> icon in the top menu bar)
2. Select the mode you wish to export
3. Click the Export Mode button (download icon)
4. Choose a location to save the `.yaml` file
5. Kilo packages the mode's configuration and any rules into the YAML file

**Importing a Mode:**

1. Open the Prompts Tab (click the <Codicon name="notebook" /> icon in the top menu bar)
2. Click the Import Mode button (upload icon)
3. Select the mode's YAML file
4. Choose the import level:
    - **Project:** Available only in current workspace (saved to `.kilocodemodes` file)
    - **Global:** Available in all projects (saved to global settings)

### Changing Slugs on Import

When importing modes, you can change the slug in the exported YAML file before importing:

1. Export a mode with slug `original-mode`
2. Edit the YAML file and change the slug to `new-mode`
3. Import the file - the import process will automatically update rule file paths to match the new slug

## Methods for Creating and Configuring Custom Modes

You can create and configure custom modes in several ways:

### 1. Ask Kilo! (Recommended)

You can quickly create a basic custom mode by asking Kilo Code to do it for you. For example:

```
Create a new mode called "Documentation Writer". It should only be able to read files and write Markdown files.
```

Kilo Code will guide you through the process, prompting for necessary information and creating the mode using the preferred YAML format.

{% callout type="tip" %}
**Create modes from job postings:** If there's a real world job posting for something you want a custom mode to do, try asking Code mode to `Create a custom mode based on the job posting at @[url]`. This can help you quickly create specialized modes with realistic role definitions.
{% /callout %}

### 2. Using the Prompts Tab

1. **Open Prompts Tab:** Click the <Codicon name="notebook" /> icon in the Kilo Code top menu bar
2. **Create New Mode:** Click the <Codicon name="add" /> button to the right of the Modes heading
3. **Fill in Fields:**

{% image src="/docs/img/custom-modes/custom-modes-2.png" alt="Custom mode creation interface in the Prompts tab" width="600" caption="Custom mode creation interface in the Prompts tab" /%}

_The custom mode creation interface showing fields for name, slug, description, save location, role definition, available tools, custom instructions._

The interface provides fields for Name, Slug, Description, Save Location, Role Definition, When to Use (optional), Available Tools, and Custom Instructions. After filling these, click the "Create Mode" button. Kilo Code will save the new mode in YAML format.

### 3. Manual Configuration (YAML & JSON)

You can directly edit the configuration files to create or modify custom modes. This method offers the most control over all properties. Kilo Code now supports both YAML (preferred) and JSON formats.

- **Global Modes:** Edit the `custom_modes.yaml` (preferred) or `custom_modes.json` file. Access it via Prompts Tab > <Codicon name="gear" /> (Settings Menu icon next to "Global Prompts") > "Edit Global Modes"
- **Project Modes:** Edit the `.kilocodemodes` file (which can be YAML or JSON) in your project root. Access it via Prompts Tab > <Codicon name="gear" /> (Settings Menu icon next to "Project Prompts") > "Edit Project Modes"

These files define an array/list of custom modes.

## YAML Configuration Format (Preferred)

YAML is now the preferred format for defining custom modes due to better readability, comment support, and cleaner multi-line strings.

### YAML Example

```yaml
customModes:
    - slug: docs-writer
      name: 📝 Documentation Writer
      description: A specialized mode for writing and editing technical documentation.
      roleDefinition: You are a technical writer specializing in clear documentation.
      whenToUse: Use this mode for writing and editing documentation.
      customInstructions: Focus on clarity and completeness in documentation.
      groups:
          - read
          - - edit # First element of tuple
            - fileRegex: \.(md|mdx)$ # Second element is the options object
              description: Markdown files only
          - browser
    - slug: another-mode
      name: Another Mode
      # ... other properties
```

### JSON Alternative

```json
{
	"customModes": [
		{
			"slug": "docs-writer",
			"name": "📝 Documentation Writer",
			"description": "A specialized mode for writing and editing technical documentation.",
			"roleDefinition": "You are a technical writer specializing in clear documentation.",
			"whenToUse": "Use this mode for writing and editing documentation.",
			"customInstructions": "Focus on clarity and completeness in documentation.",
			"groups": [
				"read",
				["edit", { "fileRegex": "\\.(md|mdx)$", "description": "Markdown files only" }],
				"browser"
			]
		}
	]
}
```

## YAML/JSON Property Details

### `slug`

- **Purpose:** A unique identifier for the mode
- **Format:** Must match the pattern `/^[a-zA-Z0-9-]+$/` (only letters, numbers, and hyphens)
- **Usage:** Used internally and in file/directory names for mode-specific rules (e.g., `.kilo/rules-{slug}/`)
- **Recommendation:** Keep it short and descriptive

**YAML Example:** `slug: docs-writer`
**JSON Example:** `"slug": "docs-writer"`

### `name`

- **Purpose:** The display name shown in the Kilo Code UI
- **Format:** Can include spaces and proper capitalization

**YAML Example:** `name: 📝 Documentation Writer`
**JSON Example:** `"name": "Documentation Writer"`

### `description`

- **Purpose:** A short, user-friendly summary displayed below the mode name in the mode selector UI
- **Format:** Keep this concise and focused on what the mode does for the user
- **UI Display:** This text appears in the redesigned mode selector

**YAML Example:** `description: A specialized mode for writing and editing technical documentation.`
**JSON Example:** `"description": "A specialized mode for writing and editing technical documentation."`

### `roleDefinition`

- **Purpose:** Detailed description of the mode's role, expertise, and personality
- **Placement:** This text is placed at the beginning of the system prompt when the mode is active

**YAML Example (multi-line):**

```yaml
roleDefinition: >-
    You are a test engineer with expertise in:
    - Writing comprehensive test suites
    - Test-driven development
```

**JSON Example:** `"roleDefinition": "You are a technical writer specializing in clear documentation."`

### `groups`

- **Purpose:** Array/list defining which tool groups the mode can access and any file restrictions
- **Available Tool Groups:** `"read"`, `"edit"`, `"browser"`, `"command"`, `"mcp"`
- **Structure:**
    - Simple string for unrestricted access: `"edit"`
    - Tuple (two-element array) for restricted access: `["edit", { fileRegex: "pattern", description: "optional" }]`

**File Restrictions for "edit" group:**

- `fileRegex`: A regular expression string to control which files the mode can edit
- In YAML, typically use single backslashes for regex special characters (e.g., `\.md$`)
- In JSON, backslashes must be double-escaped (e.g., `\\.md$`)
- `description`: An optional string describing the restriction

**YAML Example:**

```yaml
groups:
    - read
    - - edit # First element of tuple
      - fileRegex: \.(js|ts)$ # Second element is the options object
        description: JS/TS files only
    - command
```

**JSON Example:**

```json
"groups": [
  "read",
  ["edit", { "fileRegex": "\\.(js|ts)$", "description": "JS/TS files only" }],
  "command"
]
```

### `whenToUse` (Optional)

- **Purpose:** Provides guidance for Kilo's automated decision-making, particularly for mode selection and task orchestration
- **Format:** A string describing ideal scenarios or task types for this mode
- **Usage:** Used by Kilo for automated decisions and not displayed in the mode selector UI

**YAML Example:** `whenToUse: This mode is best for refactoring Python code.`
**JSON Example:** `"whenToUse": "This mode is best for refactoring Python code."`

### `customInstructions` (Optional)

- **Purpose:** A string containing additional behavioral guidelines for the mode
- **Placement:** This text is added near the end of the system prompt

**YAML Example (multi-line):**

```yaml
customInstructions: |-
    When writing tests:
    - Use describe/it blocks
    - Include meaningful descriptions
```

**JSON Example:** `"customInstructions": "Focus on explaining concepts and providing examples."`

## Benefits of YAML Format

YAML is now the preferred format for defining custom modes due to several advantages:

- **Readability:** YAML's indentation-based structure is easier for humans to read and understand
- **Comments:** YAML allows for comments (lines starting with `#`), making it possible to annotate your mode definitions
- **Multi-line Strings:** YAML provides cleaner syntax for multi-line strings using `|` (literal block) or `>` (folded block)
- **Less Punctuation:** YAML generally requires less punctuation compared to JSON, reducing syntax errors
- **Editor Support:** Most modern code editors provide excellent syntax highlighting and validation for YAML files

While JSON is still fully supported, new modes created via the UI or by asking Kilo will default to YAML.

## Migration to YAML Format

### Global Modes

Automatic migration from `custom_modes.json` to `custom_modes.yaml` happens when:

- Kilo Code starts up
- A `custom_modes.json` file exists
- No `custom_modes.yaml` file exists yet

The migration process preserves the original JSON file for rollback purposes.

### Project Modes (`.kilocodemodes`)

- No automatic startup migration occurs for project-specific files
- Kilo Code can read `.kilocodemodes` files in either YAML or JSON format
- When editing through the UI, JSON files will be converted to YAML format
- For manual conversion, you can ask Kilo to help reformat configurations

## Mode-Specific Instructions via Files/Directories

You can provide instructions for custom modes using dedicated files or directories within your workspace, allowing for better organization and version control.

### Preferred Method: Directory (`.kilo/rules-{mode-slug}/`)

```
.
├── .kilo/
│   └── rules-docs-writer/  # Example for mode slug "docs-writer"
│       ├── 01-style-guide.md
│       └── 02-formatting.txt
└── ... (other project files)
```

### Fallback Method: Single File (`.kilorules-{mode-slug}`)

```
.
├── .kilorules-docs-writer  # Example for mode slug "docs-writer"
└── ... (other project files)
```

**Rules Directory Scope:**

- **Global modes:** Rules are stored in `~/.kilo/rules-{slug}/`
- **Project modes:** Rules are stored in `{workspace}/.kilo/rules-{slug}/`

The directory method takes precedence if it exists and contains files. Files within the directory are read recursively and appended in alphabetical order.

## Configuration Precedence

Mode configurations are applied in this order:

1. **Project-level mode configurations** (from `.kilocodemodes` - YAML or JSON)
2. **Global mode configurations** (from `custom_modes.yaml`, then `custom_modes.json` if YAML not found)
3. **Default mode configurations**

**Important:** When modes with the same slug exist in both `.kilocodemodes` and global settings, the `.kilocodemodes` version completely overrides the global one for ALL properties.

## Overriding Default Modes

You can override Kilo Code's built-in modes (like 💻 Code, 🪲 Debug, ❓ Ask, 🏗️ Architect, 🪃 Orchestrator) by creating a custom mode with the same slug.

### Global Override Example

```yaml
customModes:
    - slug: code # Matches the default 'code' mode slug
      name: 💻 Code (Global Override)
      roleDefinition: You are a software engineer with global-specific constraints.
      whenToUse: This globally overridden code mode is for JS/TS tasks.
      customInstructions: Focus on project-specific JS/TS development.
      groups:
          - read
          - - edit
            - fileRegex: \.(js|ts)$
              description: JS/TS files only
```

### Project-Specific Override Example

```yaml
customModes:
    - slug: code # Matches the default 'code' mode slug
      name: 💻 Code (Project-Specific)
      roleDefinition: You are a software engineer with project-specific constraints for this project.
      whenToUse: This project-specific code mode is for Python tasks within this project.
      customInstructions: Adhere to PEP8 and use type hints.
      groups:
          - read
          - - edit
            - fileRegex: \.py$
              description: Python files only
          - command
```

## Understanding Regex in Custom Modes

Regular expressions (`fileRegex`) offer fine-grained control over file editing permissions.

{% callout type="tip" %}

**Let Kilo Build Your Regex Patterns**

Instead of writing complex regex manually, ask Kilo:

```
Create a regex pattern that matches JavaScript files but excludes test files
```

Kilo will generate the pattern. Remember to adapt it for YAML (usually single backslashes) or JSON (double backslashes).

{% /callout %}

### Important Rules for `fileRegex`

- **Escaping in JSON:** In JSON strings, backslashes (`\`) must be double-escaped (e.g., `\\.md$`)
- **Escaping in YAML:** In unquoted or single-quoted YAML strings, a single backslash is usually sufficient for regex special characters (e.g., `\.md$`)
- **Path Matching:** Patterns match against the full relative file path from your workspace root
- **Case Sensitivity:** Regex patterns are case-sensitive by default
- **Validation:** Invalid regex patterns are rejected with an "Invalid regular expression pattern" error message

### Common Pattern Examples

| Pattern (YAML-like)              | JSON fileRegex Value                | Matches                                   | Doesn't Match                      |
| -------------------------------- | ----------------------------------- | ----------------------------------------- | ---------------------------------- |
| `\.md$`                          | `"\\.md$"`                          | `readme.md`, `docs/guide.md`              | `script.js`, `readme.md.bak`       |
| `^src/.*`                        | `"^src/.*"`                         | `src/app.js`, `src/components/button.tsx` | `lib/utils.js`, `test/src/mock.js` |
| `\.(css\|scss)$`                 | `"\\.(css\|scss)$"`                 | `styles.css`, `theme.scss`                | `styles.less`, `styles.css.map`    |
| `docs/.*\.md$`                   | `"docs/.*\\.md$"`                   | `docs/guide.md`, `docs/api/reference.md`  | `guide.md`, `src/docs/notes.md`    |
| `^(?!.*(test\|spec))\.(js\|ts)$` | `"^(?!.*(test\|spec))\\.(js\|ts)$"` | `app.js`, `utils.ts`                      | `app.test.js`, `utils.spec.js`     |

### Key Regex Building Blocks

- `\.`: Matches a literal dot (YAML: `\.`, JSON: `\\.`)
- `$`: Matches the end of the string
- `^`: Matches the beginning of the string
- `.*`: Matches any character (except newline) zero or more times
- `(a|b)`: Matches either "a" or "b"
- `(?!...)`: Negative lookahead

## Error Handling

When a mode attempts to edit a file that doesn't match its `fileRegex` pattern, you'll see a `FileRestrictionError` that includes:

- The mode name
- The allowed file pattern
- The description (if provided)
- The attempted file path
- The tool that was blocked

## Example Configurations

### Basic Documentation Writer (YAML)

```yaml
customModes:
    - slug: docs-writer
      name: 📝 Documentation Writer
      description: Specialized for writing and editing technical documentation
      roleDefinition: You are a technical writer specializing in clear documentation
      groups:
          - read
          - - edit
            - fileRegex: \.md$
              description: Markdown files only
      customInstructions: Focus on clear explanations and examples
```

### Test Engineer with File Restrictions (YAML)

```yaml
customModes:
    - slug: test-engineer
      name: 🧪 Test Engineer
      description: Focused on writing and maintaining test suites
      roleDefinition: You are a test engineer focused on code quality
      whenToUse: Use for writing tests, debugging test failures, and improving test coverage
      groups:
          - read
          - - edit
            - fileRegex: \.(test|spec)\.(js|ts)$
              description: Test files only
          - command
```

### Security Review Mode (YAML)

```yaml
customModes:
    - slug: security-review
      name: 🔒 Security Reviewer
      description: Read-only security analysis and vulnerability assessment
      roleDefinition: You are a security specialist reviewing code for vulnerabilities
      whenToUse: Use for security reviews and vulnerability assessments
      customInstructions: |-
          Focus on:
          - Input validation issues
          - Authentication and authorization flaws
          - Data exposure risks
          - Injection vulnerabilities
      groups:
          - read
          - browser
```

## Troubleshooting

### Common Issues

- **Mode not appearing:** After creating or importing a mode, you may need to reload the VS Code window
- **Invalid regex patterns:** Test your patterns using online regex testers before applying them
- **Precedence confusion:** Remember that project modes completely override global modes with the same slug
- **YAML syntax errors:** Use proper indentation (spaces, not tabs) and validate your YAML

### Tips for Working with YAML

- **Indentation is Key:** YAML uses indentation (spaces, not tabs) to define structure
- **Colons for Key-Value Pairs:** Keys must be followed by a colon and a space (e.g., `slug: my-mode`)
- **Hyphens for List Items:** List items start with a hyphen and a space (e.g., `- read`)
- **Validate Your YAML:** Use online YAML validators or your editor's built-in validation

## Community Gallery

Ready to explore more? Check out the [Show and Tell](https://github.com/Kilo-Org/kilocode/discussions/categories/show-and-tell) to discover and share custom modes created by the community!
