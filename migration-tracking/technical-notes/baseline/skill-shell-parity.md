# Trusted skill shell parity

This slice ports the bounded model-initiated backtick-wrapped `!` shell
placeholders from `origin/main@ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`'s
`packages/opencode/src/kilocode/skills/inject.ts` into the Kilo v2 host. It is
deliberately not a general shell expansion mechanism.

| v1 rule                                     | Kilo v2 behavior                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expand only model-loaded skills             | The Kilo post-policy wraps the native `skill` tool; `/skill` remains the literal `Session.skill` path.                                                                                                             |
| Ignore fenced and long inline-code examples | `skill-shell-render.ts` preserves those ranges and rewrites only live placeholders.                                                                                                                                |
| Trust global/builtin source provenance      | Trust is derived from the exact isolated profile document/content source or the fixed Kilo builtin identity. `Skill.Info.location` alone never grants trust.                                                       |
| Keep project skills untrusted               | Project documents, `.kilo/.kilocode` roots, relative paths, URL sources, and ambiguous duplicate source declarations remain untrusted.                                                                             |
| Prevent symlink trust escape                | Candidate and source roots are realpathed; project descendants stay untrusted, and a lexical project skill whose final path resolves outside the project is removed from inventory. Trust resolution failure cannot enable execution. |
| Ask once for the batch                      | Portable parsing and raw/parsed native shell permission resources are collected before one Core Form containing the verbatim command list.                                                                         |
| Preserve host execution policy              | Approved commands execute through the native `shell` tool via `Tool.Service.snapshot()`, retaining jobs, interruption, sandbox/cwd checks, and native output handling.                                             |
| Bound execution                             | At most 32 unique commands, 120 seconds per native command, a 300-second post-approval budget checked before each command (matching v1), and 32 KiB per inlined result.                                                                               |
| Surface unsupported/unsafe input            | Portable scanner opaque regions reject before execution; native permission failures and interrupts are not converted into success output.                                                                          |

The host callback API is:

```ts
createSkillShell({
  layout,
  sessions,
  instances,
  global,
  fs,
  profileContent?,
  disabled?,
})
```

It returns `SkillShell(skillID, toolContext)`, an Effect returning a replacement
prepared-output string or `undefined` when the native result must remain
unchanged. `global` and `fs` are supplied by the host because
they are global services and are not provided by `Instance.provide`.

The host constructs this callback with the isolated profile services and passes
it to `createSkillPolicy({ skillShell })` as a post plugin. No ambient OS
provider history or global `.claude`/`.agents` directory is read by this
implementation.

Validation:

- `bun typecheck` in `packages/kilo-cli` passes at this checkout.
- `bun test --preload @opentui/solid/preload --timeout 30000
test/skill-shell.test.ts` passes 8 tests / 30 assertions covering renderer,
  trust, symlink, ambiguity, content-source, cap, and UTF-8 bounds.
- `dist/interactive/bun test --preload @opentui/solid/preload --timeout 30000
  test/skill-shell-live.test.ts` passes 7 tests / 34 assertions covering the
  isolated fake-model approval, rejection, native denial, headless
  cancellation, external-directory preflight, escaped-project-symlink
  inventory refusal, tool-result output, and literal `session.skill` path.
  The bundled runtime is required because the host rejects Bun < 1.4.

This is a bounded compatibility slice, not a claim that every historical v1
skill workflow is identical. In particular, only model calls through the
native v2 `skill` tool expand trusted placeholders; explicit user skill
activation remains literal, and untrusted/unsupported sources are preserved as
content without execution.
