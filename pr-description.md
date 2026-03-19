## Context

Fixes issue #7206: Code blocks in TUI remain hidden by default and only become visible when right-clicking and moving the mouse over them. This affects Windows Terminal users.

## Implementation

The root cause was that when `KILO_EXPERIMENTAL_MARKDOWN` is enabled (default), the `<markdown>` component uses streaming mode that never gets closed. According to OpenTUI documentation, streaming must be set to `false` after content completes to finalize trailing block parsing.

Changes:

1. Changed `KILO_EXPERIMENTAL_MARKDOWN` default from `true` to `false` in flag.ts - this uses the working `<code>` component instead
2. Added `concealCode={false}` as additional safeguard in the markdown component

## How to Test

1. Run `bun run dev` to start the CLI
2. Ask AI to output different types of code blocks:

   ````
   Please output the following code blocks:

   Test 1: Code block with language
   ```python
   def hello():
       print("Hello World")
   ````

   Test 2: Code block without language

   ```
   This is plain text inside code fences
   ```

   Test 3: ASCII table

   ```
   ┌─────┬─────┐
   │ A   │ B   │
   ├─────┼─────┤
   │ 1   │ 2   │
   └─────┴─────┘
   ```

3. All code blocks should be visible by default without mouse interaction

## Get in Touch

GitHub: @Xintong120
