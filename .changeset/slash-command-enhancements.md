---
"kilo-code": minor
---

feat: Enhance slash command menu with type indicators, source badges, skill invocation, and argument hints

- Add type badges (command, mode, workflow, skill) with distinct colors to the "/" slash command dropdown
- Add source labels (project, global, organization) for non-built-in items
- Add skills to the "/" slash command menu, allowing discovery and invocation of installed skills
- Color-code slash command highlights in the text input to match their type
- Support Claude Code's `argument-hint` SKILL.md frontmatter field (from the Agent Skills specification), displayed as ghost text in the input after selecting a skill command to guide usage (e.g. `[-a] [-x] <task description>`)
- Parse and propagate `argument-hint` from skill frontmatter through the full data pipeline (SkillsManager → ExtensionStateContext → SlashCommand)
