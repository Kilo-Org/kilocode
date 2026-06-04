---
title: "Onboarding Improvements"
description: "Partial roadmap for onboarding and engagement improvements"
---

# Onboarding Improvements

{% callout type="info" title="Status" %}
Partial - welcome-screen work exists. Starter cards, interactive tutorial, changelog, provider-settings changes, and funnel events below remain roadmap items unless marked current.
{% /callout %}

## Overview

New users need a clearer first-run path and better discovery of product features. This roadmap separates current welcome-screen work from proposed onboarding changes.

## Current implementation

| Capability | Status | Notes |
|---|---|---|
| Welcome screen | Current | Existing first-run surface provides starting context for new users |

## Roadmap requirements

| Capability | Status | Proposed behavior |
|---|---|---|
| Starter prompt cards | Planned | Replace generic prompt with contextual actions and codicon visuals |
| Interactive tutorial | Planned | Guide users through current UI controls and chat input |
| Tutorial completion state | Planned | Avoid showing completed or skipped tutorial repeatedly |
| In-product changelog | Planned | Surface relevant product changes to returning users |
| Kilo provider settings layout | Planned | Put provider setup action beside relevant field and improve discoverability |
| Onboarding analytics | Planned | Track onboarding progress and later product engagement |

## Proposed welcome-screen extension

Add starter prompt cards to welcome screen. Each card should populate chat input when selected and use VS Code codicons rather than emoji.

| Card | Prompt |
|---|---|
| Debug helper | Help me fix a bug in my code |
| Feature builder | Add a new feature to my project |
| Documentation | Generate documentation for this file |
| Code review | Review my current changes by running `git diff` and analyzing output |

## Proposed tutorial flow

Earlier design notes referred to Chat, Edit, and Architect modes. Treat those names as historical examples, not current UI requirements. Implementation should target controls available when tutorial is built.

| Step | Focus | Content |
|---|---|---|
| Welcome | Interface | Explain purpose of short tour |
| Agent or mode selection | Current selector UI | Explain available task behaviors |
| Side panels and MCP | Sidebar | Point to history and MCP configuration |
| Starting chat | Input area | Explain prompts and file references |
| Starter prompts | Welcome actions | Show common first tasks |

## Proposed analytics

Events remain roadmap items. Final names and payloads require telemetry review before implementation.

| Funnel | Candidate events |
|---|---|
| Onboarding | `onboarding.started`, `onboarding.tutorial.completed`, `onboarding.tutorial.skipped`, `onboarding.prompt.selected`, `onboarding.finished` |
| Engagement | `chat.started`, `mode.changed`, `changelog.viewed`, `changelog.dismissed`, `provider.configured`, `file.referenced`, `mcp.configured` |

## Future work

- Funnel analysis for onboarding drop-off
- Project-aware first-action recommendations
- Progressive disclosure of advanced features
- Role-specific onboarding flows
- Prompt suggestions based on project code
- Team and repository-specific onboarding
