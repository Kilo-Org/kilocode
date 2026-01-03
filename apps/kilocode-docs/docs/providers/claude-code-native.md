---
sidebar_label: Claude Code Native
---

# Using Claude Code With Kilo Code

Claude Code is Anthropic's official CLI that provides direct access to Claude models from your terminal. Using Claude Code with Kilo Code lets you leverage your existing CLI setup without needing separate API keys. This implementation uses an updated technique to speak directly to the Claude API, eliminating many of the downsides of the previous implementation. It is cache efficient, and token efficient.

## Supported Models

Kilo Code supports the following Claude models through Claude Code:

- **Claude Opus 4.5** (Most capable)
- **Claude Sonnet 4.5** (Latest, recommended)
- **Claude 4.5 Haiku** (Fast responses)

## Preparing to Configure

1. Install `claude` using the Homebrew or 'native' [installation methods](https://claudelog.com/install-claude-code/):

- macOS or Linux: `curl -fsSL https://claude.ai/install.sh | bash`
- macOS: `brew install --cask claude-code`
- Windows: `irm https://claude.ai/install.ps1 | iex`

2. Login to `claude` and get a long lived token (good for one year): `claude setup-token`

3. Record the token value - it will not be shown again.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "Claude Code Native" from the "API Provider" dropdown.
3. **Select Model:** Choose your desired Claude model from the "Model" dropdown.
4. **Enter your Token:** Using the token from recorded above, enter it as your API key
5. Use claude as normal!

## Tips and Notes

- **Advanced Reasoning:** Full support for Claude's thinking modes and reasoning capabilities when available.
- **Context Windows:** Claude models have large context windows, allowing you to include significant amounts of code and context in your prompts.
- **Enhance Prompt Feature:** Full compatibility with Kilo Code's Enhance Prompt feature, allowing you to automatically improve and refine your prompts before sending them to Claude.
