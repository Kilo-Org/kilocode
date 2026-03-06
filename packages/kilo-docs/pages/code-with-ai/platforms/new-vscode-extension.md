---
title: "New VS Code Extension (Pre-Release)"
description: "The new Kilo Code VS Code extension, now available in pre-Release.
---

# New VS Code Extension (Pre-Release)

The new Kilo Code VS Code extension is now available in pre-Release.
You can install the pre-release version from the [VS Code Marketplace](https://kilo.ai/docs/getting-started/installing#vs-code-preview).

:::info

We're rebuilding Kilo Code from the ground up on the new Kilo CLI. The pre-release extension is available for users who want to try the latest architecture and provide feedback, and don't mind some missing features and rough edges.

:::

{% callout type="warning" title="Early Release" %}
This is an early release — features and behavior may change frequently as we iterate toward GA.
{% /callout %}

---

## About

The new extension is built on top of the Kilo CLI 1.0 architecture, which powers a more consistent and scalable agent runtime across environments.

- **Built on the new CLI foundation**
- **Actively in pre-Release** — improvements and features are being shipped frequently
- **Designed to align the IDE experience** with the CLI and future platform capabilities

If you encounter any issues, please report them on GitHub:
👉 [https://github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues)

---

## Available Features

The pre-release currently includes:

- Core chat and agent behavior
- Auto Model
- Kilo Gateway support
- Autocomplete
- Agent Manager

*(This list will expand as additional capabilities are enabled.)*

---

## Known Limitations

Because this extension runs on the new runtime, there are a few important differences from the previous version:

**Sessions do not migrate**
Existing sessions from the previous extension will not appear.
The new extension uses Kilo CLI 1.0 session storage.

**Settings do not carry over**
You'll need to reconfigure any preferences or providers.

We plan to support Settings migration ahead of general availability.

---

## Feedback

Your feedback is extremely valuable during pre-Release.
If something feels broken, confusing, or missing, please let us know so we can improve it quickly.

Report issues here:
👉 [https://github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues)
