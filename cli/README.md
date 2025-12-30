# Kilo Code CLI
Agentic coding from your terminal. Plan, debug, and build with the same powerful agents from the Kilo IDE extensions, all from the command line.
Switch between 500+ models, run parallel agents without conflicts, and automate tasks in CI/CD pipelines. Your sessions sync across CLI, VS Code, JetBrains, and web so you never lose context.
[Documentation](https://kilo.ai/docs/cli) · [Discord](https://discord.gg/rrAeUT9d) · [Website](https://kilo.ai)
![Terminal-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/8356e318-580d-4ea2-86f5-61a96b35cc1c)
## Install
```bash
npm install -g @kilocode/cli
```
Then configure your API token:
```bash
kilocode config
```
You can find your token at [app.kilo.ai](https://app.kilo.ai) in your profile settings.
## Quick start
```bash
# Start an interactive session
kilocode

# Start with a specific mode
kilocode --mode architect

# Resume your last conversation
kilocode --continue

# Run interactively without any command approval prompts - use only in protected sandbox environments
kilocode --yolo

# Run autonomously (for CI/CD or scripting)
kilocode --auto "Implement feature X"
```
## What you can do
**Use the right mode for the job.** Switch between Code, Ask, Debug, Architect, and Orchestrator modes depending on what you're working on.

**Run parallel agents.** Spin up multiple Kilo instances on the same codebase without conflicts. Each agent works on a separate git branch.
```bash
# Terminal 1
kilocode --parallel "refactor auth module"

# Terminal 2
kilocode --parallel "add unit tests for payments"
```

**Automate with autonomous mode.** Run Kilo in CI/CD pipelines or scripts without user interaction.

> ⚠️ **Warning:** Autonomous mode executes commands without confirmation. Only run in safe, isolated sandbox environments.

```bash
kilocode --auto "Implement feature X" --timeout 300
```

**Switch models on the fly.** Use `/model select` to change models mid-session (press Tab to autocomplete model names). Pick the right tradeoff between speed, cost, and reasoning for each task.

## Configuration
Auto-approval settings let Kilo execute commands without confirmation. You can build these up incrementally during interactive sessions—when Kilo requests approval, you can choose to "Always allow" specific commands, which adds them to your config automatically.

You can also edit `~/.kilocode/config.json` directly:
```json
{
  "autoApproval": {
    "enabled": true,
    "execute": {
      "allowed": ["npm", "git", "pnpm"],
      "denied": ["rm -rf", "sudo"]
    }
  }
}
```
See the [full configuration reference](https://kilo.ai/docs/cli#config-reference) for all options.
## Known issues
- **Light mode terminals:** Theme detection isn't automatic yet. Run `kilocode config` to switch themes.
- **Windows:** Not currently supported. See [#3034](https://github.com/Kilo-Org/kilocode/issues/3034) for status.
- **Dependency warnings:** You may see deprecation warnings during install. These are cosmetic and will be resolved soon.
## Feedback
Report bugs or request features on [GitHub](https://github.com/Kilo-Org/kilocode) or join our [Discord](https://discord.gg/rrAeUT9d).
## Local development
### Getting started
To build and run the CLI locally off your branch:
#### Build the VS Code extension
```shell
cd src
pnpm bundle
pnpm vsix
pnpm vsix:unpackged
cd ..
```
#### Install CLI dependencies
```shell
cd cli
pnpm install
pnpm deps:install
```
#### Build the CLI
```shell
pnpm clean
pnpm clean:kilocode
pnpm copy:kilocode
pnpm build
```
#### Configure CLI settings
```shell
pnpm start config
```
#### Run the built CLI
```shell
pnpm start
```
### Using DevTools
To run the CLI with devtools, add `DEV=true` to your `pnpm start` command, then run `npx react-devtools` to show the devtools inspector.
