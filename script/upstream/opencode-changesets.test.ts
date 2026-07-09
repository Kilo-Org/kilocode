import { describe, expect, test } from "bun:test"

import { changeset, select, type Release } from "./opencode-changesets"

const releases: Release[] = [
  { tag_name: "v1.2.3", body: "Patch release" },
  { tag_name: "v1.2.2", body: "\r\n## Core\r\n\r\n- Fix issue\r\n" },
  { tag_name: "1.2.1", body: "Old tag without prefix" },
  { tag_name: "v1.2.0", body: "Base release" },
  { tag_name: "v1.2.4", body: "Draft release", draft: true },
  { tag_name: "v1.2.5", body: "Prerelease", prerelease: true },
]

describe("opencode changesets", () => {
  test("selects releases in semver range with normalized tags", () => {
    expect(select(releases, "1.2.0", "v1.2.3")).toEqual([
      { tag_name: "v1.2.1", body: "Old tag without prefix" },
      { tag_name: "v1.2.2", body: "\r\n## Core\r\n\r\n- Fix issue\r\n" },
      { tag_name: "v1.2.3", body: "Patch release" },
    ])
  })

  test("excludes prereleases", () => {
    expect(() => select(releases, "1.2.3", "1.2.5")).toThrow("Target opencode release does not exist")
  })

  test("requires the target release to exist", () => {
    expect(() => select(releases, "1.2.0", "99.9.9")).toThrow("Target opencode release does not exist")
  })

  test("requires the starting release to exist", () => {
    expect(() => select(releases, "1.1.9", "1.2.3")).toThrow("Starting opencode release does not exist")
  })

  test("formats changeset markdown", () => {
    expect(changeset([{ tag_name: "v1.2.2", body: "\r\n## Core\r\n\r\n- Fix issue\r\n" }], "1.2.1", "1.2.2")).toBe(`---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.2.1 to v1.2.2 upstream:

- Core: Fix issue
`)
  })

  test("filters ignored sections and contributor thanks", () => {
    expect(
      changeset(
        [
          {
            tag_name: "v1.2.2",
            body: `## Core

- Keep this

## Desktop

- Drop this

## SDK

- Drop sdk

**Thank you to 1 community contributor:**

- @user:
  - Helped
`,
          },
        ],
        "1.2.1",
        "1.2.2",
      ),
    ).toBe(`---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.2.1 to v1.2.2 upstream:

- Core: Keep this
`)
  })

  test("bundles release notes into shared sections", () => {
    expect(
      changeset(
        [
          {
            tag_name: "v1.2.1",
            body: `## Core

### Bugfixes

- Fix first

## TUI

### Improvements

- Improve first
`,
          },
          {
            tag_name: "v1.2.2",
            body: `## Core

### Bugfixes

- Fix second

### Improvements

- Improve core

## TUI

### Improvements

- Improve second
`,
          },
        ],
        "1.2.0",
        "1.2.2",
      ),
    ).toBe(`---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.2.0 to v1.2.2 upstream:

- Core Bugfixes: Fix first
- Core Bugfixes: Fix second
- Core Improvements: Improve core
- TUI Improvements: Improve first
- TUI Improvements: Improve second
`)
  })

  test("preserves multiline markdown blocks", () => {
    expect(
      changeset(
        [
          {
            tag_name: "v1.2.2",
            body: `## Core

### Improvements

- Parent item
  - Nested item

  Continuation paragraph
- Second item
`,
          },
        ],
        "1.2.1",
        "1.2.2",
      ),
    ).toBe(`---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.2.1 to v1.2.2 upstream:

- Core Improvements: Parent item
    - Nested item

    Continuation paragraph
- Core Improvements: Second item
`)
  })
})
