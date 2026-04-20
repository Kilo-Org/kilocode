# devil-ui Conventions

Effective 2026-04-19 (Phase 5 onwards).

This document records the authoritative coding conventions for the `packages/devil-ui` package.
All contributors and agents MUST follow these rules. Tests enforce many of these rules structurally.

---

## 1. `<Show fallback>` MUST use the lazy form

SolidJS evaluates eager JSX immediately, which causes the terminal branch to be evaluated
even in a DOM environment. Always use the thunk (lazy) form to defer evaluation.

```tsx
// ❌ Do NOT: eager JSX — terminal branch evaluated regardless of target
<Show when={target.kind === "dom"} fallback={<TerminalStub foo={bar} />}>

// ✅ DO: thunk form — terminal branch only evaluated when actually needed
<Show when={target.kind === "dom"} fallback={() => <TerminalStub foo={bar} />}>

// ✅ Also acceptable when SolidJS types require cast (1.9.x):
<Show when={target.kind === "dom"} fallback={(() => <TerminalStub foo={bar} />) as unknown as JSX.Element}>
```

---

## 2. ARIA boolean attributes MUST be string-typed

SolidJS passes boolean props directly to the DOM in some renderers. Use string literals.

```tsx
// ❌ Do NOT: boolean aria attribute — fails accessibility audits in some renderers
<button aria-pressed={isActive}>

// ✅ DO: string form
<button aria-pressed={isActive ? "true" : "false"}>

// ✅ Similarly for aria-expanded, aria-selected, aria-disabled, aria-modal
<div aria-expanded={open ? "true" : "false"}>
```

---

## 3. No `@opentui/*` static imports outside primitive terminal branches and adapters

Static `@opentui/*` imports at module level will pollute the DOM bundle and fail
in Storybook / JSDOM test environments. Only dynamic require inside terminal branch
functions is allowed.

```tsx
// ❌ Do NOT: top-level static import
import { useKeyboard } from "@opentui/solid"

// ✅ DO: dynamic require inside the terminal branch function body
function TerminalBranch(props: Props): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useKeyboard } = require("@opentui/solid") as { useKeyboard: (cb: (evt: { key: string }) => void, opts?: unknown) => void }
  useKeyboard((evt) => { ... }, {})
  return <box>...</box>
}
```

Tests enforce this: see `*-terminal.test.ts` for structural assertions.

---

## 4. PasteModal single-line caveat

OpenTUI has no `<textarea>`. The terminal branch of `PasteModal` uses a single-line
`<input>` element. Multi-line paste is only possible via system paste (the terminal
intercepts it and fires the `onInput` event with the full pasted content).

Document this inline wherever the terminal branch is implemented:
```tsx
{/* Single-line only — OpenTUI has no <textarea>; multi-line via system paste only */}
```

---

## 5. Test harness

Use structural source-file assertions (Bun native) for component tests. Do NOT use
`@solidjs/testing-library` or JSDOM for devil-ui tests — they have known friction with
the dual-branch render architecture.

```ts
// ✅ Pattern established in Phase 3
const SRC = readFileSync(join(__dirname, "../my-component.tsx"), "utf-8")
describe("MyComponent", () => {
  it("exports MyComponent", () => {
    const { MyComponent } = require("../my-component")
    expect(typeof MyComponent).toBe("function")
  })
  it("has correct prop", () => {
    expect(SRC).toContain("myProp")
  })
})
```

---

## 6. Storybook branch

DOM branches only in Storybook stories. Terminal branch coverage belongs in
`*-terminal.test.ts` structural test files, NOT in `.stories.tsx` files.

---

## 7. useCommandRegistry is the keybind source

`useKeybindRegistry` does NOT exist. All keybind information comes from
`Command.keybind` on commands returned by `useCommandRegistry().search(...)`.

```tsx
// ❌ Do NOT: registry does not exist
const kb = useKeybindRegistry()

// ✅ DO: keybinds come from Command.keybind field
const registry = useCommandRegistry()
const cmds = registry.search("", scope)
const withKeybinds = cmds.filter((c) => c.keybind != null)
```

---

## 8. readOnly prop pattern for display-only table views

When a component needs a read-only view (e.g. RosterTable in OnboardingWizard review step),
add `readOnly?: boolean` to the props type. When `readOnly=true`:
- Render `<span>{value}</span>` instead of `<input>/<select>`
- Hide mutating action buttons (add, delete)
- Do NOT call `onEdit`/`onDelete`/`onAdd` handlers

```tsx
export type MyTableProps = {
  // ...
  readOnly?: boolean
}
```

---

## 9. No cross-package static imports for `@devilcode/cli` in devil-ui

`@devilcode/cli` is not in `packages/devil-ui/package.json` dependencies to avoid
a Turbo cyclic dependency graph error. Use the lazy-require pattern:

```ts
const mod = require("@devilcode/cli/devilcode/team/config") as { CanonicalTeamConfig: ... }
```

See `use-team-validation.tsx` and `position-picker.tsx` for established patterns.
