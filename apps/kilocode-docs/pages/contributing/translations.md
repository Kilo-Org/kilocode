---
title: "Localization and Crowdin"
description: "How to contribute translations and evaluate Crowdin integration for Kilo docs"
---

# Localization and Crowdin

This page documents how localization contributions currently work, and how to evaluate a Crowdin-based workflow for scaling translations.

## Current Translation Workflow

Today, documentation text changes are contributed through normal pull requests:

1. Fork the repo and create a branch
2. Update the relevant docs files
3. Open a PR with context about language/locale changes

This works well for occasional translation updates, but can become hard to coordinate at scale.

## Why Consider Crowdin

Crowdin can improve translation operations by:

- Centralizing translator access and review workflow
- Tracking source-text changes and translation drift
- Managing glossary/terminology consistency across locales
- Reducing manual copy/paste between PRs

## Suggested Crowdin Pilot Plan

Use a short pilot before committing to a permanent integration:

1. Create a Crowdin project for docs content only
2. Sync one constrained section (for example, Getting Started pages)
3. Enable one or two target locales
4. Validate translation quality and update latency for 2-4 weeks
5. Decide whether to expand to full docs coverage

## Technical Starting Point

If you implement the pilot, use the official Docusaurus Crowdin guidance:

- https://docusaurus.io/docs/i18n/crowdin

{% callout type="info" title="Scope Recommendation" %}
Start with docs pages first, then expand to UI strings if the workflow is successful.
{% /callout %}

## Contributing Translation Improvements

If you'd like to help with localization now:

- Improve English source clarity first (it improves all locales downstream)
- Submit translation PRs for high-traffic docs pages
- Open issues for terminology inconsistencies
