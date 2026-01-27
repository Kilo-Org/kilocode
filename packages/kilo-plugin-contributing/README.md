# kilo-plugin-contributing

An OpenCode plugin that generates and maintains a living contributing guide for your project.

## Overview

This plugin helps maintain a comprehensive `CONTRIBUTING.md` document that serves as the definitive guide for AI agents and human contributors working on your project. The guide covers:

- **Brief Overview** - High-level project description and purpose
- **Technology Choices** - Languages, frameworks, and tooling decisions
- **Development** - Setup, workflow, and coding standards
- **Architecture** - System design, patterns, and structure
- **Product** - Features, goals, and domain knowledge

## How It Works

The plugin hooks into `experimental.chat.system.transform` to:

1. Read the current contents of your project's contributing guide
2. Inject the guide into the system prompt so the AI has full context
3. Encourage the AI to keep the contributing guide up-to-date as it learns about the project

This creates a feedback loop where the AI both reads from and writes to the contributing guide, keeping it accurate and comprehensive over time.

## Installation

```
npm install -S @kilocode/kilo-plugin-contributing
```

Add the plugin to your OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@kilocode/kilo-plugin-contributing"]
}
```

## Configuration

The plugin expects a `CONTRIBUTING.md` file in your project root. If one doesn't exist, it will be created with a template structure.
