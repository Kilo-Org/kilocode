---
sidebar_label: Claude Code
---

{% callout type="warning" title="Important Notice" %}
In January 2026, Anthropic decided to restrict Claude Code CLI to official Claude Code clients. Claude Code credentials cannot be used in Kilo Code or other third-party harnesses.

For continued use of Anthropic models in Kilo Code, please use the [Anthropic API provider](/ai-providers/anthropic) with an API key instead.
{% /callout %}

# Using Claude Code With Kilo Code

Claude Code is Anthropic's official CLI that provides direct access to Claude models from your terminal. Using Claude Code with Kilo Code lets you leverage your existing CLI setup without needing separate API keys.

**Website:** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## Installing and Setting Up Claude Code

1. **Install Claude Code:** Follow the installation instructions at [Anthropic's Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/setup).
2. **Authenticate:** Run `claude` in your terminal. Claude Code offers multiple authentication options including the Anthropic Console (default), Claude App with Pro/Max plans, and enterprise platforms like Amazon Bedrock or Google Vertex AI. See [Anthropic's authentication documentation](https://docs.anthropic.com/en/docs/claude-code/setup) for complete details.
3. **Verify Installation:** Test that everything works by running `claude --version` in your terminal.

{% callout type="warning" title="Environment Variable Usage" %}
The `claude` command-line tool, like other Anthropic SDKs, can use the `ANTHROPIC_API_KEY` environment variable for authentication. This is a common method for authorizing CLI tools in non-interactive environments.

If this environment variable is set on your system, the `claude` tool may use it for authentication instead of the interactive `/login` method. When Kilo Code executes the tool, it will accurately reflect that an API key is being used, as this is the underlying behavior of the `claude` CLI itself.
{% /callout %}

**Website:** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## Supported Models

The specific models available depend on your Claude subscription and plan. See [Anthropic's Model Documentation](https://docs.anthropic.com/en/docs/about-claude/models) for more details on each model's capabilities.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Claude Code" from the "API Provider" dropdown.
3. **Select Model:** Choose your desired Claude model from the "Model" dropdown.
4. **(Optional) Custom CLI Path:** If you installed Claude Code to a location other than the default `claude` command, enter the full path to your Claude executable in the "Claude Code Path" field. Most users won't need to change this.

## Tips and Notes

- **No API Keys Required:** Claude Code uses your existing CLI authentication, so you don't need to manage separate API keys.
- **Cost Transparency:** Usage costs are reported directly by the Claude CLI, giving you clear visibility into your spending.
- **Advanced Reasoning:** Full support for Claude's thinking modes and reasoning capabilities when available.
- **Context Windows:** Claude models have large context windows, allowing you to include significant amounts of code and context in your prompts.
- **Enhance Prompt Feature:** Full compatibility with Kilo Code's Enhance Prompt feature, allowing you to automatically improve and refine your prompts before sending them to Claude.
- **Custom Paths:** If you installed Claude Code in a non-standard location, you can specify the full path in the settings. Examples:
    - Windows: `C:\tools\claude\claude.exe`
    - macOS/Linux: `/usr/local/bin/claude` or `~/bin/claude`

## Troubleshooting

- **"Claude Code process exited with error":** Verify Claude Code is installed (`claude --version`) and authenticated (`claude auth login`). Make sure your subscription includes the selected model.
- **Custom path not working:** Use the full absolute path to the Claude executable and verify the file exists and is executable. On Windows, include the `.exe` extension.
