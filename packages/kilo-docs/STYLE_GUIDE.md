---
title: "Documentation Style Guide"
description: "Guidelines for writing Kilo Code documentation"
---

# Documentation Style Guide

This guide covers writing, formatting, and structuring documentation for the Kilo Code docs site.

## Voice and Tone

Kilo Code documentation should be:

- **Clear and direct** - Cut unnecessary words. Prefer active voice.
- **Helpful, not salesy** - Focus on what users can do, not just what's possible.
- **Consistent** - Use the same terminology and phrasing across pages.
- **Friendly but professional** - Write as a knowledgeable teammate explaining concepts.

### Do

- Write in the second person ("you")
- Use present tense
- Be specific: "Run `kilo run` to execute a task" not "You can run kilo run"

### Don't

- Use marketing fluff or hype language
- Write in passive voice when active is clearer
- Assume prior knowledge not explicitly stated

## Headings

- Use sentence case for heading text
- Start with the most important word
- One heading per section
- Use heading levels logically (don't skip from H2 to H4)

```markdown
## Installing Kilo Code

### VS Code Extension

### CLI
```

## Procedures

Use numbered lists for step-by-step instructions. Each step should be a complete action.

```markdown
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Kilo Code"
4. Click the dropdown arrow next to **Install** and select **Install Pre-Release Version**
```

### Procedural tips

- Include keyboard shortcuts in parentheses
- Use present tense
- Start each step with a verb
- Don't number sub-steps; use nested lists instead

## Callouts

Use callouts to highlight important information. Choose the right type:

| Type | Use for |
|---|---|
| `note` | General information users should know |
| `tip` | Helpful shortcuts or best practices |
| `info` | Context or background information |
| `warning` | Potential problems or important cautions |
| `danger` | Critical warnings that could cause data loss |
| `generic` | Content without a specific visual treatment |

```markdown
{% callout type="tip" %}
**The easiest way to configure Kilo is to ask the agent.** Just tell the agent what you want.
{% /callout %}
```

## Cross-References

- Use absolute paths starting from `/docs/` for internal links
- Don't include `.md` extensions
- Use descriptive link text, not "click here"

```markdown
Good: [Quickstart Guide](/docs/getting-started/quickstart)

Bad: [Click here](/docs/getting-started/quickstart)
```

## Code Examples

- Use fenced code blocks with language specified
- Include comments in code where helpful
- Show realistic, working examples
- Use `kilo run` for CLI examples, not hypothetical commands

````markdown
```bash
kilo run "create a utils.py file with a function that adds two numbers"
```
````

### Code in prose

Use backticks for inline code, file references, and commands:

- `kilo.jsonc` for configuration files
- `Ctrl+Shift+X` for keyboard shortcuts
- `src/utils.ts` for file paths

## Markdoc Conventions

### Images

Use the Markdoc image tag format:

```markdown
{% image src="/docs/img/kilo-provider/connected-accounts.png" alt="Connect account screen" width="800" caption="Connect account screen" /%}
```

**Image path rules:**
- Always include `/docs` prefix
- Use generated screenshots from `packages/kilo-docs/public/img/screenshot-tests/` when available
- Write descriptive alt text for accessibility

### Tables

Use compact markdown tables without padding:

```markdown
| Command | What it runs |
|---|---|
| `kilo serve` | The prod CLI on `$PATH`. |
```

### Tabs

Use tabs for platform-specific content:

```markdown
{% tabs %}
{% tab label="VS Code" %}

Content for VS Code

{% /tab %}
{% tab label="CLI" %}

Content for CLI

{% /tab %}
{% /tabs %}
```

### Mermaid Diagrams

Use fenced `mermaid` blocks for architecture diagrams:

````markdown
```mermaid
flowchart LR
  A --> B
```
````

## LLM-Generated Docs

This documentation site is maintained with AI assistance. When reviewing or editing:

- Verify technical accuracy manually
- Ensure examples actually work
- Check that terminology is consistent
- Don't accept generated content without review

## Terminology

Use consistent terms throughout:

| Term | Use for |
|---|---|
| Kilo Code | The product name |
| kilo CLI | The command-line interface |
| VS Code extension | The VS Code extension |
| JetBrains plugin | The JetBrains IDE plugin |
| `kilo serve` | The local HTTP server |
| `kilo run` | The headless execution command |
| agent | The AI assistant |

## Navigation

- Add new pages to the appropriate nav file in `lib/nav/`
- Update `lib/nav/index.ts` to export the new nav section
- Navigation files are organized by section (e.g., `getting-started.ts`, `code-with-ai.ts`)

## Documentation Lifecycle

- Follow the branch naming convention: `docs/description-of-change`
- For documentation-only changes, create branches with the `docs/` prefix
- Update navigation when adding or removing pages
- Add redirects in `previous-docs-redirects.js` when moving or removing pages