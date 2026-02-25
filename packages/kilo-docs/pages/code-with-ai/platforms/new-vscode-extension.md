---
title: "New VS Code Extension (Beta)"
description: "The new Kilo Code VS Code extension, now available in beta"
---

# New VS Code Extension (Beta)

The new Kilo Code VS Code extension is now available in beta.
You can install it directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.kilo-code).

{% callout type="warning" title="Early Release" %}
This is an early release — features and behavior may change frequently as we iterate toward GA.
{% /callout %}

---

## About

The new extension is built on top of the Kilo CLI 1.0 architecture, which powers a more consistent and scalable agent runtime across environments.

- **Built on the new CLI foundation**
- **Actively in beta** — improvements and features are being shipped frequently
- **Designed to align the IDE experience** with the CLI and future platform capabilities

If you encounter any issues, please report them on GitHub:
👉 [https://github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues)

---

## Available Features

The beta currently includes:

- Core chat and agent behavior
- Kilo Auto mode
- Model and gateway selection
- AutoComplete
- Checkpoints
- Agent Manager

*(This list will expand as additional capabilities are enabled.)*

---

## Known Limitations

Because this extension runs on the new runtime, there are a few important differences from the previous version:

**Sessions do not migrate**
Existing sessions from the previous extension will not appear.
The new extension uses CLI 1.0 session storage.

**Settings do not carry over**
You'll need to reconfigure any preferences or providers.

We're actively exploring migration options ahead of general availability.

---

## Feedback

Your feedback is extremely valuable during beta.
If something feels broken, confusing, or missing, please let us know so we can improve it quickly.

Report issues here:
👉 [https://github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues)
