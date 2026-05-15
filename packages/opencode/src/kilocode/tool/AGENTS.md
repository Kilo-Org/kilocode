# Tool Description Guidelines

Kilo standardizes tool descriptions to a specific structure and guidelines.
This helps the agent make better selections about which tools to call.
When tool descriptions vary wildly in structure and size, it can lead to
some tool descriptions taking a higher weight over the others and being called
more often than intended, or other tools being called less often than intended.

## Canonical structure

Every tool description MUST follow this order. Middle sections may be omitted when empty,
but ordering is fixed.

```
## Summary

## When to use

## When NOT to use

## Examples

## Constraints
```

### 1. `## Summary`

One sentence stating what the tool does, followed by at most one supporting sentence on
capability breadth. No bullets. No headers. No restating the tool name. Do not include the header `## Summary`.

```
Search for exact string matches in file content recursively within a directory, returning all matches.

Returns file names, line numbers, and line content for all matched lines.
```

Rules:

- Lead with a verb (Retrieve, Create, Build, Structure…).
- Do not begin with "This tool…" — the reader knows it is a tool.
- No marketing adjectives ("comprehensive", "powerful", "robust").

### 2. `## When to use`

Distinct capability bullets — 5–8 maximum. Each bullet describes a capability no other
bullet already covers.

```
## When to use

- Find usages or definitions for known symbol names
- Find source location of string constants, documentation strings, etc.
- Check for remaining TODOs, TBDs, FIXMEs, etc.
```

Rules:

- Bullets are capabilities, not trigger phrases and not example prompts (those sections
  exist separately).
- Drop any bullet that rephrases another — duplication across `When to use` bullets is the
  single largest source of docstring bloat.
- Do not replace this section with a TRIGGER PHRASES AND KEYWORDS dump.

### 3. `## When NOT to use`

Real routing collisions only. 3–5 bullets. Each bullet must name a specific alternative tool.

```
## When NOT to use

- Find files by filename — use `Glob`
- Read the full or partial contents of a known file — use `Read`
- Codebase exploration when exact symbol name is not known - use `SemanticSearch` if available
```

Rules:

- If you cannot name a specific peer tool, the bullet does not belong here.
- Do not list generic misuses ("do not use for unrelated requests").

### 4. `## Examples`

Prompt → hint pairs. 3–6 maximum. Short, imperative, in user voice.

```
## Examples

- "main(" → all matches containing the exact string "main("
- "TBD|TODO|placeholder" → all matches containing any of the pipe-separated strings
```

Rules:

- Each example demonstrates a different code path or argument shape. No two examples should
  exercise the same behavior.
- Hints are one line. If a hint needs explanation, that explanation belongs in `## Constraints`.

### 5. `## Constraints`

Hard rules the agent must respect when calling this tool. Omit the section entirely if there
are none.

```
## Constraints

- Date ranges: provide EITHER explicit dates (`YYYY-MM-DD`) OR relative offsets ("30d", "1m") — never both.
- Label filtering: provide BOTH `label_id` AND `label_name` together, or neither.
```

Rules:

- Each constraint is a single imperative sentence.
- Constraints describe how to call this tool, not how to behave conversationally.
  Conversational rules ("always thank the user", "use a friendly tone") belong in the
  system prompt.
- Keep to ≤5 constraints. If you have more, the tool likely has too many responsibilities.

## Formatting rules

- Header style is fixed: `## Sentence case`. Not ALL_CAPS, not `**bold:**`, not XML tags,
  not `### Sub-headers`.
- No sub-headers inside sections. If you need sub-structure, the section is doing too much —
  split into a new section or trim.
- Bullets use `-`, never `*` or numbered lists.
- Code, tool names, and identifiers use backticks: `` `Grep` ``, `` `SemanticSearch` ``.

**Target length:**

| Complexity | Line count |
|---|---|
| Narrow tools (single capability) | up to 20 lines |
| Standard tools | 30–50 lines |
| Complex orchestration tools | 60–80 lines |

Nothing above 80 lines. If you are over, `When to use` duplication or embedded routing
logic is the likely cause.

## Tool Description Template

```
<Verb> <what this tool does — one sentence.>
<Optional: one sentence on capability breadth. Omit if the summary stands alone.>

## When to use

- <Distinct capability — not a trigger phrase or example prompt>
- <Distinct capability>
- <Distinct capability>
- <Distinct capability — add up to 8 total; delete unused placeholders>

## When NOT to use

- <Conflicting use case> — use `<AlternativeToolName>`
- <Conflicting use case> — use `<AlternativeToolName>`
- <Conflicting use case — add up to 5; delete unused placeholders>

## Examples

- "<User-voice prompt>" → <one-line hint describing the code path exercised>
- "<User-voice prompt>" → <one-line hint — each example must differ from the others>
- "<User-voice prompt>" → <one-line hint>

## Constraints

- <Hard rule the agent must follow when calling this tool.>
- <Omit this section entirely if no constraints apply.>
```
