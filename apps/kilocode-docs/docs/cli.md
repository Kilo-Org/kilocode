# Kilo Code CLI

Orchestrate agents from your terminal. Plan, debug, and code fast with keyboard-first navigation on the command line.

The Kilo Code CLI uses the same underlying technology that powers the IDE extensions, so you can expect the same workflow to handle agentic coding tasks from start to finish.

## Install

`npm install -g @kilocode/cli`

Next, `cd` to change directories into the project where you'd like to work with Kilo.

Run:

`kilocode`

to start the CLI and begin a new task with your preferred model and relevant mode.

## What you can do with Kilo Code CLI

- **Plan and execute code changes without leaving your terminal.** Use your command line to make edits to your project without opening your IDE.
- **Switch between 400+ LLMs without constraints.** Other CLI tools only work with one model or curate opinionated lists. With Kilo, you can switch between hundreds of models without booting up another tool.
- **Choose the right mode for the task in your workflow.** Select between Architect, Ask, Debug, Orchestrator, or custom agent modes.
- **Automate tasks.** Get AI assistance writing shell scripts for tasks like renaming all of the files in a folder or transforming sizes for a set of images.

## CLI reference

### CLI commands

| Command         | Description                                                      | Example                     |
| --------------- | ---------------------------------------------------------------- | --------------------------- |
| `kilocode`      | Start interactive                                                |                             |
| `/mode`         | Switch between modes (architect, code, debug, ask, orchestrator) | `/mode orchestrator`        |
| `/model`        | Learn about available models and switch between them             |                             |
| `/model list`   | List available models                                            |                             |
| `/model info`   | Prints description for a specific model by name                  | `/model info z-ai/glm-4.5v` |
| `/model select` | Select and switch to a new model                                 |                             |
| `/new`          | Start a new task with the agent with a clean slate               |                             |
| `/help`         | List available commands and how to use them                      |                             |
| `/exit`         | Exit the CLI                                                     |                             |

### CLI flags

| Flag     | Description                                                                                           | Example |
| -------- | ----------------------------------------------------------------------------------------------------- | ------- |
| `--auto` | Prompts the AI agents to work autonomously without interaction or user input until a task is complete |         |

## Config reference for providers

Kilo gives you the ability to bring your own keys for a number of model providers and AI gateways, like OpenRouter and Vercel AI Gateway. Each provider has unique configuration options and some let you set environment variables.

You can reference the [Provider Configuration Guide](https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md) for examples if you want to edit .config files manually. You can also run:

`kilocode config`

to complete configuration with an interactive workflow on the command line.
