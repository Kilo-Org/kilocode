---
sidebar_position: 5
title: "Spec: Improve Onboarding Flow"
---

# SPEC: Kilo Code Onboarding & User Engagement Improvements

# Overview

New users get minimal onboarding with generic prompts and no feature guidance. This causes poor engagement and users miss key capabilities. Existing users lack visibility into new features.

This spec proposes improved welcome screens, interactive tutorials, and in-product changelog to drive better activation and feature adoption.

# Requirements

- Replace generic "CSS gradient generator" prompt with 4+ contextually relevant starter prompts with visual icons
- Implement interactive tutorial system highlighting key UI elements (modes, mcp, settings)
- Display in-product changelog with smart visibility rules for returning users
- Remember tutorial completion state to avoid showing it repeatedly to users
- Implement analytics tracking for onboarding completion rates and user engagement metrics

# Tasks

## Welcome Screen Redesign

Redesign welcome screen with visual appeal and actionable starter prompts.

**Layout Structure:**

```
+----------------------------------+
|        [KiloCode Logo]           |
|     "Welcome to KiloCode"        |
|                                  |
|  +--------+  +--------+          |
|  | Card 1 |  | Card 2 |          |
|  +--------+  +--------+          |
|                                  |
|  +--------+  +--------+          |
|  | Card 3 |  | Card 4 |          |
|  +--------+  +--------+          |
|                                  |
|  [Skip] [Start Tutorial]         |
+----------------------------------+
```

**Starter Prompt Cards Ideas**

- **Debug Helper**: 🐛 "Help me fix a bug in my code"
- **Feature Builder**: ⚡ "Add a new feature to my project"
- **Documentation**: 📝 "Generate documentation for this file"
- **Code Review**: 🔍 "Review my current changes by running `git diff` and analyzing the output"

Each card will have:

- Hover state with subtle elevation
- Click to populate chat input
- Icon using VS Code's codicon library

## In-App Tutorial Flow

Users aren't guided through Kilo Code's modes or key features. The existing tab-based tutorial is easily dismissed, causing users to miss critical functionality.

Replace the tab-based tutorial with an in-app experience using specific highlighting flows to guide users through core functionality.

**Tutorial Flow**

```
Step 1: Welcome
├── Highlight: Entire interface
├── Content: "Welcome to KiloCode! Let's take a quick tour."
└── Actions: [Skip Tour] [Next]

Step 2: Mode Selection
├── Highlight: Mode selector buttons
├── Content: "Choose between Chat, Edit, and Architect modes for different tasks"
└── Actions: [Back] [Next]

Step 3: Side Panels & MCP Configuration
├── Highlight: Left sidebar
├── Content: "Access history, memory, and configure MCP servers for enhanced capabilities"
└── Actions: [Back] [Next]

Step 4: Starting a Chat
├── Highlight: Input area
├── Content: "Type your request here or use @ to reference files"
└── Actions: [Back] [Next]

Step 5: Starter Prompts
├── Highlight: Starter prompt area
├── Content: "Use these prompts to get started quickly with common tasks"
└── Actions: [Back] [Finish]
```

## Kilo Provider Settings UI Improvements

The "Set API Key" button is at the bottom of settings, making Kilo Code setup hard to discover and complete.

**Improvements:**

- Move "Set API Key" button next to API key input field
- Rearrange layout for better flow
- Make Kilo Code provider setup prominent
- Reduce setup friction

## Analytics Integration

Track user interactions to identify where users drop off in the product funnel. This data enables targeted improvements to increase activation rates.

**Key Funnel Events to Track:**

**Onboarding Funnel:**

- `onboarding.started`
- `onboarding.tutorial.completed`
- `onboarding.tutorial.skipped`
- `onboarding.prompt.selected` (with prompt type)
- `onboarding.finished` - Critical completion milestone

**Product Engagement Funnel:**

- `chat.started` - First interaction with core functionality
- `mode.changed` (with mode type) - Feature discovery and usage
- `changelog.viewed` - Re-engagement with new features
- `changelog.dismissed`
- `provider.configured` - Setup completion
- `file.referenced` - Advanced feature usage (@-mentions)
- `mcp.configured` - Power user feature adoption

**Drop-off Analysis Goals:**

- Identify at what point users stop progressing through onboarding
- Measure conversion from onboarding completion to first chat
- Track mode adoption rates and feature discovery patterns
- Understand re-engagement effectiveness through changelog interactions

## In-Product Changelog

Re-engage inactive users by highlighting new features and improvements. Acts as a reminder system to reactivate dormant users and keep active users informed.

## Features for the Future

- **User Drop-off Funnel Analysis**: Implement comprehensive PostHog funnel tracking to identify where users abandon the onboarding flow and create targeted recovery strategies
- **Contextual Project Analysis**: Detect and analyze user's project structure to provide personalized first-action recommendations based on their codebase
- Progressive disclosure of advanced features over time
- Personalized onboarding flows based on user role (frontend dev, backend dev, DevOps)
- AI-powered prompt suggestions based on actual project code patterns
- Integration with Kilo Code teams for company/repo-personalized onboarding
