# Auto-Launch Configuration

Auto-Launch Configuration allows you to automatically start a Kilo Code task when opening a workspace, with support for specific profiles and modes. This was originally developed as an internal test feature, but we decided to expose it to users in case anyone finds it useful!

:::info
Auto-Launch Configuration is particularly useful for testing the same prompt against multiple models or project directories.
:::

## How It Works

When you open a workspace in VS Code, Kilo Code automatically checks for a launch configuration JSON file. If found, it:

- Switches to the specified provider profile (if provided)
- Changes to the specified mode (if provided)
- Launches a task with your predefined prompt

This happens seamlessly in the background, requiring no manual intervention.

## Creating a Launch Configuration

### Basic Setup

1. Create a `.kilocode` directory in your workspace root (if it doesn't exist)
2. Create a `launchConfig.json` file inside the `.kilocode` directory
3. Configure your launch settings using the JSON format below

### Configuration Format

```json
{
	"prompt": "Your task description here",
	"profile": "Profile Name (optional)",
	"mode": "mode-name (optional)"
}
```

#### Required Fields

- **`prompt`** (string): The task message that will be sent to the AI when the workspace opens

#### Optional Fields

- **`profile`** (string): Name of an existing [API Configuration Profile](/features/api-configuration-profiles) to use for this task. Must exactly match a profile name from your settings.

- **`mode`** (string): The Kilo Code mode to use for this task. Available modes:
    - `"code"` - General-purpose coding tasks
    - `"architect"` - Planning and technical design
    - `"ask"` - Questions and explanations
    - `"debug"` - Problem diagnosis and troubleshooting
    - `"test"` - Testing-focused workflows
    - Custom mode slugs (if you have [custom modes](/agent-behavior/custom-modes))

## Example Configurations

### Basic Task Launch

```json
{
	"prompt": "Review this codebase and suggest improvements for performance and maintainability"
}
```

### Profile-Specific Task

```json
{
	"prompt": "Create comprehensive unit tests for all components in the src/ directory",
	"profile": "GPT-4 Turbo"
}
```

### Architecture Planning with Claude

```json
{
	"prompt": "Design a scalable microservices architecture for this e-commerce platform with focus on security and performance",
	"profile": "🎻 Sonnet 4",
	"mode": "architect"
}
```

### Model Comparison Setup

```json
{
	"prompt": "Optimize this algorithm for better time complexity and explain your approach",
	"profile": "🧠 Qwen",
	"mode": "code"
}
```

## Use Cases

### Development Workflows

- **Project Templates**: Include launch configurations in project templates to immediately start with appropriate AI assistance
- **Code Reviews**: Automatically trigger code review tasks when opening pull request branches
- **Documentation**: Launch documentation generation tasks for new projects

### Testing and Comparison

- **Model Testing**: Create different configurations to test how various AI models handle the same prompt
- **A/B Testing**: Compare approaches by switching between different profiles and modes
- **Benchmarking**: Systematically test AI performance across different scenarios

### Team Collaboration

- **Consistent Setup**: Ensure all team members use the same AI configuration for specific projects
- **Onboarding**: Help new team members start with optimal AI settings automatically
- **Standards**: Enforce coding standards by launching with specific profiles and modes

## File Location

The configuration file must be located at:

```
your-workspace/
└── .kilocode/
    └── launchConfig.json
```

This file should be at the root of your workspace (the same level as your main project files).

## Behavior and Timing

- Auto-launch triggers approximately 500ms after Kilo Code extension activation
- The sidebar automatically receives focus before the task launches
- Profile switching happens before mode switching (if both are specified)
- The task launches after all configuration changes are applied
- If profile or mode switching fails, the task continues with current settings

## Troubleshooting

### Configuration Not Loading

1. Verify file location: `.kilocode/launchConfig.json` in workspace root
2. Check JSON syntax with a JSON validator
3. Ensure `prompt` field is present and not empty
4. Check VS Code Developer Console for error messages

### Profile Not Switching

1. Verify the profile name exactly matches one from your settings
2. Profile names are case-sensitive and must match exactly (including emojis)
3. Check that the profile exists in your [API Configuration Profiles](/features/api-configuration-profiles)

### Mode Not Switching

1. Verify the mode name is valid (code, architect, ask, debug, test)
2. For custom modes, use the exact mode slug from your configuration
3. Mode names are case-sensitive and should be lowercase
