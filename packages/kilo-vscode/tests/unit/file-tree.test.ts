import { describe, it, expect } from "bun:test"
import {
  buildFileTree,
  flatten,
  flattenChain,
  treeOrder,
  type FileTreeNode,
} from "../../webview-ui/agent-manager/file-tree-utils"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

function diff(file: string, status?: "added" | "deleted" | "modified"): WorktreeFileDiff {
  return { file, before: "", after: "", additions: 1, deletions: 0, status }
}

// ── buildFileTree ──────────────────────────────────────────────────────────

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([])
  })

  it("sorts root-level files alphabetically", () => {
    const tree = buildFileTree([diff("README.md"), diff("package.json")])
    expect(tree).toHaveLength(2)
    expect(tree[0]!.name).toBe("package.json")
    expect(tree[0]!.path).toBe("package.json")
    expect(tree[0]!.children).toBeUndefined()
    expect(tree[1]!.name).toBe("README.md")
  })

  it("groups files under shared directories", () => {
    const tree = buildFileTree([diff("src/a.ts"), diff("src/b.ts")])
    expect(tree).toHaveLength(1)
    const src = tree[0]!
    expect(src.name).toBe("src")
    expect(src.path).toBe("src")
    expect(src.children).toHaveLength(2)
    expect(src.children![0]!.name).toBe("a.ts")
    expect(src.children![1]!.name).toBe("b.ts")
  })

  it("creates nested directory structure", () => {
    const tree = buildFileTree([diff("src/components/Button.tsx")])
    expect(tree).toHaveLength(1)
    const src = tree[0]!
    expect(src.name).toBe("src")
    expect(src.children).toHaveLength(1)
    const components = src.children![0]!
    expect(components.name).toBe("components")
    expect(components.path).toBe("src/components")
    expect(components.children).toHaveLength(1)
    expect(components.children![0]!.name).toBe("Button.tsx")
    expect(components.children![0]!.path).toBe("src/components/Button.tsx")
  })

  it("reuses existing directory nodes for shared prefixes", () => {
    const tree = buildFileTree([diff("src/a.ts"), diff("src/utils/b.ts"), diff("src/utils/c.ts")])
    const src = tree[0]!
    expect(src.children).toHaveLength(2) // a.ts, utils/
    const utils = src.children!.find((n) => n.name === "utils")!
    expect(utils.children).toHaveLength(2)
    expect(utils.children![0]!.name).toBe("b.ts")
    expect(utils.children![1]!.name).toBe("c.ts")
  })

  it("handles deeply nested paths", () => {
    const tree = buildFileTree([diff("a/b/c/d/e.ts")])
    expect(tree[0]!.name).toBe("a")
    expect(tree[0]!.children![0]!.name).toBe("b")
    expect(tree[0]!.children![0]!.children![0]!.name).toBe("c")
    expect(tree[0]!.children![0]!.children![0]!.children![0]!.name).toBe("d")
    expect(tree[0]!.children![0]!.children![0]!.children![0]!.children![0]!.name).toBe("e.ts")
  })

  it("sorts directories before files at each level", () => {
    const tree = buildFileTree([diff("README.md"), diff("src/index.ts"), diff("test/index.test.ts")])
    expect(tree).toHaveLength(3) // src/, test/, README.md
    expect(tree[0]!.name).toBe("src")
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[1]!.name).toBe("test")
    expect(tree[1]!.children).toHaveLength(1)
    expect(tree[2]!.name).toBe("README.md")
    expect(tree[2]!.children).toBeUndefined()
  })

  it("attaches diff data to leaf nodes", () => {
    const d = diff("src/a.ts", "added")
    const tree = buildFileTree([d])
    const leaf = tree[0]!.children![0]!
    expect(leaf.diff).toBe(d)
  })

  it("does not attach diff data to directory nodes", () => {
    const tree = buildFileTree([diff("src/a.ts")])
    expect(tree[0]!.diff).toBeUndefined()
  })

  it("sorts directories before files within each level", () => {
    const tree = buildFileTree([diff("src/a.ts"), diff("src/b/c.ts")])
    const src = tree[0]!
    expect(src.children).toHaveLength(2)
    // Directory before file
    expect(src.children![0]!.name).toBe("b")
    expect(src.children![0]!.children).toBeDefined()
    expect(src.children![1]!.name).toBe("a.ts")
    expect(src.children![1]!.children).toBeUndefined()
  })

  it("separates diverging paths with common prefix", () => {
    const tree = buildFileTree([diff("src/a.ts"), diff("src/b/c.ts")])
    const src = tree[0]!
    expect(src.children).toHaveLength(2)
    const file = src.children!.find((n) => n.name === "a.ts")
    const dir = src.children!.find((n) => n.name === "b")
    expect(file).toBeDefined()
    expect(file!.children).toBeUndefined()
    expect(dir).toBeDefined()
    expect(dir!.children).toHaveLength(1)
  })
})

// ── flattenChain ───────────────────────────────────────────────────────────

describe("flattenChain", () => {
  it("returns node unchanged when it has no children", () => {
    const node: FileTreeNode = { name: "file.ts", path: "file.ts" }
    expect(flattenChain(node)).toBe(node)
  })

  it("returns node unchanged when it has multiple children", () => {
    const node: FileTreeNode = {
      name: "src",
      path: "src",
      children: [
        { name: "a.ts", path: "src/a.ts" },
        { name: "b.ts", path: "src/b.ts" },
      ],
    }
    expect(flattenChain(node)).toBe(node)
  })

  it("returns node unchanged when single child is a file (no children)", () => {
    const node: FileTreeNode = {
      name: "src",
      path: "src",
      children: [{ name: "index.ts", path: "src/index.ts" }],
    }
    expect(flattenChain(node)).toBe(node)
  })

  it("flattens single-child directory chain", () => {
    const node: FileTreeNode = {
      name: "src",
      path: "src",
      children: [
        {
          name: "components",
          path: "src/components",
          children: [{ name: "Button.tsx", path: "src/components/Button.tsx" }],
        },
      ],
    }
    const result = flattenChain(node)
    expect(result.name).toBe("src/components")
    expect(result.path).toBe("src/components")
    expect(result.children).toHaveLength(1)
    expect(result.children![0]!.name).toBe("Button.tsx")
  })

  it("flattens deeply nested single-child chains", () => {
    const node: FileTreeNode = {
      name: "a",
      path: "a",
      children: [
        {
          name: "b",
          path: "a/b",
          children: [
            {
              name: "c",
              path: "a/b/c",
              children: [{ name: "file.ts", path: "a/b/c/file.ts" }],
            },
          ],
        },
      ],
    }
    const result = flattenChain(node)
    expect(result.name).toBe("a/b/c")
    expect(result.path).toBe("a/b/c")
  })

  it("stops flattening at multi-child branch points", () => {
    const node: FileTreeNode = {
      name: "a",
      path: "a",
      children: [
        {
          name: "b",
          path: "a/b",
          children: [
            { name: "x.ts", path: "a/b/x.ts" },
            { name: "y.ts", path: "a/b/y.ts" },
          ],
        },
      ],
    }
    const result = flattenChain(node)
    expect(result.name).toBe("a/b")
    expect(result.children).toHaveLength(2)
  })
})

// ── flatten ─────────────────────────────────────────────────────────────────

describe("flatten", () => {
  it("returns empty array for empty input", () => {
    expect(flatten([])).toEqual([])
  })

  it("leaves file nodes unchanged", () => {
    const nodes: FileTreeNode[] = [{ name: "file.ts", path: "file.ts" }]
    const result = flatten(nodes)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("file.ts")
    expect(result[0]!.children).toBeUndefined()
  })

  it("flattens single-child directory chains into combined names", () => {
    const nodes: FileTreeNode[] = [
      {
        name: "src",
        path: "src",
        children: [
          {
            name: "components",
            path: "src/components",
            children: [{ name: "Button.tsx", path: "src/components/Button.tsx" }],
          },
        ],
      },
    ]
    const result = flatten(nodes)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("src/components")
    expect(result[0]!.children).toHaveLength(1)
    expect(result[0]!.children![0]!.name).toBe("Button.tsx")
  })

  it("does not flatten directories with multiple children", () => {
    const nodes: FileTreeNode[] = [
      {
        name: "src",
        path: "src",
        children: [
          { name: "a.ts", path: "src/a.ts" },
          { name: "b.ts", path: "src/b.ts" },
        ],
      },
    ]
    const result = flatten(nodes)
    expect(result[0]!.name).toBe("src")
    expect(result[0]!.children).toHaveLength(2)
  })

  it("flattens recursively through nested levels", () => {
    // a/ -> b/ -> c/ -> {x.ts, y.ts}
    // Should flatten a/b/c with children [x.ts, y.ts]
    const nodes: FileTreeNode[] = [
      {
        name: "a",
        path: "a",
        children: [
          {
            name: "b",
            path: "a/b",
            children: [
              {
                name: "c",
                path: "a/b/c",
                children: [
                  { name: "x.ts", path: "a/b/c/x.ts" },
                  { name: "y.ts", path: "a/b/c/y.ts" },
                ],
              },
            ],
          },
        ],
      },
    ]
    const result = flatten(nodes)
    expect(result[0]!.name).toBe("a/b/c")
    expect(result[0]!.children).toHaveLength(2)
  })

  it("handles a real-world project structure", () => {
    const diffs = [
      diff("packages/ui/src/components/Button.tsx"),
      diff("packages/ui/src/components/Modal.tsx"),
      diff("packages/ui/src/index.ts"),
      diff("packages/cli/src/main.ts"),
      diff("README.md"),
    ]
    const result = flatten(buildFileTree(diffs))
    // packages/ should not flatten because it has ui/ and cli/
    // packages/ui/src has two children (components/ and index.ts) — no flatten
    // packages/cli/src has one child (main.ts) which is a file — no flatten
    const packages = result.find((n) => n.name.startsWith("packages"))
    expect(packages).toBeDefined()
    // Root-level README should be present
    const readme = result.find((n) => n.name === "README.md")
    expect(readme).toBeDefined()
  })

  it("does not flatten a directory whose single child is a file", () => {
    const nodes: FileTreeNode[] = [
      {
        name: "src",
        path: "src",
        children: [{ name: "index.ts", path: "src/index.ts" }],
      },
    ]
    const result = flatten(nodes)
    // src/ has one child, but that child is a file (no children), so no flatten
    expect(result[0]!.name).toBe("src")
    expect(result[0]!.children).toHaveLength(1)
    expect(result[0]!.children![0]!.name).toBe("index.ts")
  })
})

// ── treeOrder ──────────────────────────────────────────────────────────────

describe("treeOrder", () => {
  it("returns empty array for empty input", () => {
    expect(treeOrder([])).toEqual([])
  })

  it("returns single-element array unchanged", () => {
    const input = [diff("a.ts")]
    expect(treeOrder(input)).toEqual(input)
  })

  it("groups files by directory", () => {
    // Git lexicographic order interleaves directories: a/x, b/y, a/z
    // but buildFileTree groups by directory: a/{x,z}, b/{y}
    const input = [diff("a/x.ts"), diff("b/y.ts"), diff("a/z.ts")]
    const result = treeOrder(input)
    expect(result.map((d) => d.file)).toEqual(["a/x.ts", "a/z.ts", "b/y.ts"])
  })

  it("groups untracked files with their directory siblings", () => {
    // The actual bug: backend appends untracked/new files AFTER all tracked
    // files. settings-io.ts (untracked, added) ends up after all the tracked
    // i18n modifications, but should appear with its directory siblings.
    const input = [
      diff("src/components/settings/about.ts"), // tracked modification
      diff("src/i18n/ar.ts"), // tracked modification
      diff("src/i18n/de.ts"), // tracked modification
      diff("src/i18n/en.ts"), // tracked modification
      diff("src/components/settings/settings-io.ts"), // untracked, appended last
      diff("tests/unit/settings-io.test.ts"), // untracked, appended last
    ]
    const result = treeOrder(input)
    // Tree groups by directory: components/settings/ together, i18n/ together
    // Directories sorted alphabetically: components/ before i18n/ before tests/
    expect(result.map((d) => d.file)).toEqual([
      "src/components/settings/about.ts",
      "src/components/settings/settings-io.ts", // now grouped with about.ts!
      "src/i18n/ar.ts",
      "src/i18n/de.ts",
      "src/i18n/en.ts",
      "tests/unit/settings-io.test.ts",
    ])
  })

  it("reorders when git path sort diverges from tree grouping", () => {
    // Files from the same directory are scattered in the input (e.g. because
    // untracked files are appended after tracked files)
    const input = [
      diff("pkg/tests/a.test.ts"),
      diff("pkg/webview/src/components/x.ts"),
      diff("pkg/webview/src/i18n/ar.ts"),
      diff("pkg/webview/src/i18n/de.ts"),
      diff("pkg/tests/b.test.ts"),
    ]
    const result = treeOrder(input)
    // Tree groups and sorts: tests/{a,b}, webview/src/{components/x, i18n/{ar,de}}
    expect(result.map((d) => d.file)).toEqual([
      "pkg/tests/a.test.ts",
      "pkg/tests/b.test.ts",
      "pkg/webview/src/components/x.ts",
      "pkg/webview/src/i18n/ar.ts",
      "pkg/webview/src/i18n/de.ts",
    ])
  })

  it("sorts root-level files alphabetically", () => {
    const input = [diff("README.md"), diff("package.json"), diff("tsconfig.json")]
    const result = treeOrder(input)
    expect(result.map((d) => d.file)).toEqual(["package.json", "README.md", "tsconfig.json"])
  })

  it("puts directories before files at each level", () => {
    const input = [diff("README.md"), diff("src/a.ts"), diff("src/b.ts"), diff("tsconfig.json")]
    const result = treeOrder(input)
    expect(result.map((d) => d.file)).toEqual(["src/a.ts", "src/b.ts", "README.md", "tsconfig.json"])
  })
})
