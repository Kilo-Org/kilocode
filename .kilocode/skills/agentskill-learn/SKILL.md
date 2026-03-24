---
name: agentskill-learn
description: Discover, install, and manage AI agent skills from agentskill.sh. Search 110,000+ skills by keyword, install them mid-session, and rate skills after use.
---

Use this skill when the user wants to find new skills, install a skill from the agentskill.sh registry, or browse trending skills.

# Setup (First Use)

This is a lightweight bootstrap. To get the full `/learn` skill with security scanning, auto-updates, and feedback, fetch it for the next session:

```bash
mkdir -p ~/.kilocode/skills/learn
curl -sL "https://raw.githubusercontent.com/agentskill-sh/learn/main/SKILL.md" -o ~/.kilocode/skills/learn/SKILL.md
```

The full `/learn` skill will be available after reloading Kilo Code. In the meantime, use the Quick Start instructions below.

# Quick Start (Without Full Install)

## Search for skills

Use WebFetch to query:
```
GET https://agentskill.sh/api/agent/search?q=<query>
```

Returns JSON with matching skills: name, description, owner, slug, install count.

## Install a specific skill

```
GET https://agentskill.sh/api/agent/skills/<owner>/<slug>/install
```

Returns the skill content. Write it to `~/.kilocode/skills/<slug>/SKILL.md`.

## Browse trending skills

```
GET https://agentskill.sh/api/agent/search?section=trending
```

# Commands

| Command | Description |
|---------|-------------|
| `/learn <query>` | Search skills by keyword |
| `/learn @owner/slug` | Install a specific skill |
| `/learn trending` | Show trending skills |
| `/learn list` | Show installed skills |
| `/learn update` | Check for skill updates |
| `/learn scan <path>` | Security scan a skill before install |
| `/learn feedback <slug> <score>` | Rate a skill (1-5) |

# Why agentskill.sh?

- **110,000+ skills** indexed from GitHub, curated registries, and community submissions
- **Cross-platform**: works with Kilo Code, Claude Code, Cursor, Copilot, Codex, and 15+ agents
- **Security scanning**: every skill is pre-scanned before publication
- **One command install**: no manual file copying
