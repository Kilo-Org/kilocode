---
sidebar_position: 1
title: "Engineering Specs"
---

# Engineering Specs

Engineering specs are technical documents that describe how we plan to implement features and solve problems. They help us align on requirements, communicate progress, and document our architectural decisions.

## Why Write Specs?

As the company gets bigger and gains adoption, it's important to evolve how we work together. There are more teams and more stakeholders than ever, and with that, more opportunities for mis-communication and untimely disagreements.

Writing specs for reasonably complicated projects has many benefits:

- Improves clarity of implementation
- Reduces time to implementation
    - Often times, after a spec is written, it's fed into an LLM to implement the changes
- Allows for discussion (and maybe some healthy bike shedding) prior to implementation
    - Importantly, aligns on requirements prior to implementation
- Communicates upward and outward
    - Helps leadership understand the progress of a project
    - Helps teammates understand how various parts of our application is architected

It is useful to start with an outline/template for specs. For that, refer to the [SPEC: Template](./spec-template.md) document.

## Current Specs

| Spec                                                                    | Description                                |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| [Enterprise MCP Controls](./spec-enterprise-mcp-controls.md)            | Admin controls for MCP server allowlists   |
| [Onboarding Improvements](./spec-onboarding-engagement-improvements.md) | User onboarding and engagement features    |
| [Organization Modes Library](./spec-organization-modes-library.md)      | Shared modes for teams and enterprise      |
| [Agentic Security Reviews](./spec-security-reviews.md)                  | AI-powered security vulnerability analysis |
| [Track Repo URL](./spec-track-repo-url.md)                              | Usage tracking by repository/project       |
| [Voice Transcription](./spec-voice-transcription.md)                    | Live voice input for chat                  |

Private specs, for example backend non-user facing features, can be found on the [company handbook (Kilo internal)](https://handbook.kilo.ai/engineering/specs/why-specs).

## Contributing a Spec

If you're working on a significant feature, consider writing a spec:

1. Copy the [Spec Template](./spec-template.md)
2. Fill in the sections with your proposal
3. Submit a PR for review
4. Discuss and iterate with the team
5. Once approved, create GitHub issues from the implementation plan
