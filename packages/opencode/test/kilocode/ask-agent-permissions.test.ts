import { test, expect, describe } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

// Reconstruct the Ask agent's readOnlyBash allowlist (mirrors agent.ts)
const readOnlyBash: Record<string, "allow" | "ask" | "deny"> = {
  "*": "deny",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  "git *": "allow",
  "git add *": "deny",
  "git commit *": "deny",
  "git push *": "deny",
  "git merge *": "deny",
  "git rebase *": "deny",
  "git cherry-pick *": "deny",
  "git reset *": "deny",
  "git checkout *": "deny",
  "git switch *": "deny",
  "git stash *": "deny",
  "git tag *": "deny",
  "git am *": "deny",
  "git apply *": "deny",
  "git remote set-url *": "deny",
  "git remote add *": "deny",
  "git remote remove *": "deny",
  "git clean *": "deny",
  "git mv *": "deny",
  "git rm *": "deny",
  "git config *": "deny",
  "git clone *": "deny",
  "git pull *": "deny",
  "git init *": "deny",
  "git worktree *": "deny",
  "git submodule *": "deny",
  "git revert *": "deny",
  "git bisect *": "deny",
  "git filter-branch *": "deny",
  "git fetch *": "deny",
  "git restore *": "deny",
  "gh *": "ask",
}

/** Build the Ask agent ruleset without MCP servers */
function askRuleset() {
  return PermissionNext.fromConfig({
    "*": "deny",
    bash: readOnlyBash,
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
    grep: "allow",
    glob: "allow",
    list: "allow",
    question: "allow",
    webfetch: "allow",
    websearch: "allow",
    codesearch: "allow",
    codebase_search: "allow",
  })
}

/** Build the Ask agent ruleset WITH MCP servers and optional user config */
function askRulesetWithMcp(servers: string[], user: PermissionNext.Ruleset = []) {
  const mcpRules: Record<string, "allow" | "ask" | "deny"> = {}
  for (const key of servers) {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, "_")
    mcpRules[sanitized + "_*"] = "ask"
  }
  // Mirrors agent.ts merge order: user, ask-specific (with mcpRules), user denies last
  return PermissionNext.merge(
    user,
    PermissionNext.fromConfig({
      "*": "deny",
      bash: readOnlyBash,
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
      grep: "allow",
      glob: "allow",
      list: "allow",
      question: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      codebase_search: "allow",
      ...mcpRules,
    }),
    user.filter((r) => r.action === "deny"),
  )
}

describe("Ask agent bash permissions", () => {
  const ruleset = askRuleset()

  describe("allowed read-only commands", () => {
    const allowed: [string, string][] = [
      ["cat", "cat README.md"],
      ["ls", "ls -la"],
      ["grep", "grep -r TODO src/"],
      ["rg", "rg pattern"],
      ["jq", "jq '.name' package.json"],
      ["head", "head -n 10 file.txt"],
      ["tail", "tail -f log.txt"],
      ["wc", "wc -l src/index.ts"],
      ["diff", "diff a.txt b.txt"],
      ["sort", "sort names.txt"],
      ["tree", "tree src/"],
      ["echo", "echo hello"],
      ["pwd", "pwd"],
      ["date", "date"],
      ["whoami", "whoami"],
    ]

    for (const [name, cmd] of allowed) {
      test(`${name}: "${cmd}" → allow`, () => {
        const result = PermissionNext.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("allow")
      })
    }
  })

  describe("allowed git read commands", () => {
    const allowed = [
      "git log --oneline -10",
      "git diff HEAD~1",
      "git show HEAD:src/index.ts",
      "git status",
      "git branch -a",
      "git log --graph",
      "git blame src/index.ts",
      "git rev-parse HEAD",
    ]

    for (const cmd of allowed) {
      test(`"${cmd}" → allow`, () => {
        const result = PermissionNext.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("allow")
      })
    }
  })

  describe("denied git write commands", () => {
    const denied = [
      "git commit -m 'test'",
      "git push origin main",
      "git merge feature",
      "git rebase main",
      "git reset --hard HEAD~1",
      "git checkout -b new-branch",
      "git switch main",
      "git stash",
      "git tag v1.0",
      "git cherry-pick abc123",
      "git am patch.diff",
      "git apply changes.patch",
      "git clean -fd",
      "git mv old.ts new.ts",
      "git rm file.ts",
      "git add .",
      "git remote add origin url",
      "git remote remove upstream",
      "git remote set-url origin url",
      "git config user.name test",
      "git clone https://example.com/repo",
      "git pull origin main",
      "git init",
      "git worktree add ../branch",
      "git submodule update --init",
      "git revert HEAD",
      "git bisect start",
      "git filter-branch --all",
      "git fetch origin",
      "git restore src/index.ts",
    ]

    for (const cmd of denied) {
      test(`"${cmd}" → deny`, () => {
        const result = PermissionNext.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
      })
    }
  })

  describe("denied write/execute commands", () => {
    const denied = [
      "find . -exec rm {} \\;",
      "touch newfile.ts",
      "mkdir src/new",
      "cp a.ts b.ts",
      "mv old.ts new.ts",
      "tsc --noEmit",
      "tar xzf archive.tar.gz",
      "npm install",
      "python3 script.py",
      "rm -rf /",
      "node server.js",
      "bun run dev",
      "curl http://example.com",
    ]

    for (const cmd of denied) {
      test(`"${cmd}" → deny`, () => {
        const result = PermissionNext.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
      })
    }
  })

  test("gh commands → ask", () => {
    expect(PermissionNext.evaluate("bash", "gh pr view 123", ruleset).action).toBe("ask")
    expect(PermissionNext.evaluate("bash", "gh issue list", ruleset).action).toBe("ask")
    expect(PermissionNext.evaluate("bash", "gh api repos/org/repo", ruleset).action).toBe("ask")
  })
})

describe("Ask agent tool disabled checks", () => {
  const ruleset = askRuleset()

  test("bash tool is NOT disabled (has specific allow rules after deny)", () => {
    const result = PermissionNext.disabled(["bash"], ruleset)
    expect(result.has("bash")).toBe(false)
  })

  test("allowed tools are not disabled", () => {
    const tools = ["read", "grep", "glob", "list", "question", "webfetch", "websearch", "codesearch", "codebase_search"]
    const result = PermissionNext.disabled(tools, ruleset)
    for (const tool of tools) {
      expect(result.has(tool)).toBe(false)
    }
  })

  test("edit tools are disabled", () => {
    const tools = ["edit", "write", "patch", "multiedit"]
    const result = PermissionNext.disabled(tools, ruleset)
    for (const tool of tools) {
      expect(result.has(tool)).toBe(true)
    }
  })

  test("task tool is disabled", () => {
    const result = PermissionNext.disabled(["task"], ruleset)
    expect(result.has("task")).toBe(true)
  })

  test("todowrite and todoread are disabled", () => {
    const result = PermissionNext.disabled(["todowrite", "todoread"], ruleset)
    expect(result.has("todowrite")).toBe(true)
    expect(result.has("todoread")).toBe(true)
  })
})

describe("Ask agent MCP permissions", () => {
  test("MCP tools not disabled when servers configured", () => {
    const ruleset = askRulesetWithMcp(["my-server", "another_server"])
    const result = PermissionNext.disabled(["my-server_sometool", "another_server_listthing"], ruleset)
    expect(result.has("my-server_sometool")).toBe(false)
    expect(result.has("another_server_listthing")).toBe(false)
  })

  test("MCP tools evaluate to ask", () => {
    const ruleset = askRulesetWithMcp(["my-server"])
    const result = PermissionNext.evaluate("my-server_read_file", "*", ruleset)
    expect(result.action).toBe("ask")
  })

  test("MCP tools disabled without server config", () => {
    const ruleset = askRuleset()
    const result = PermissionNext.disabled(["my-server_sometool"], ruleset)
    expect(result.has("my-server_sometool")).toBe(true)
  })

  test("server names with special characters are sanitized", () => {
    const ruleset = askRulesetWithMcp(["my.special server!"])
    // "my.special server!" → "my_special_server_"
    const result = PermissionNext.disabled(["my_special_server__sometool"], ruleset)
    expect(result.has("my_special_server__sometool")).toBe(false)

    const eval_ = PermissionNext.evaluate("my_special_server__sometool", "*", ruleset)
    expect(eval_.action).toBe("ask")
  })

  test("MCP rules don't interfere with built-in tool permissions", () => {
    const ruleset = askRulesetWithMcp(["server1"])
    // Built-in tools should still work normally
    expect(PermissionNext.evaluate("read", "src/index.ts", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("bash", "ls -la", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("bash", "git commit -m test", ruleset).action).toBe("deny")

    // Edit tools should still be disabled
    const disabled = PermissionNext.disabled(["edit", "write"], ruleset)
    expect(disabled.has("edit")).toBe(true)
    expect(disabled.has("write")).toBe(true)
  })

  test("user config deny overrides MCP ask rules", () => {
    const deny = PermissionNext.fromConfig({ "my-server_*": "deny" })
    const ruleset = askRulesetWithMcp(["my-server"], deny)
    // User explicitly denied this server — should stay denied
    const result = PermissionNext.disabled(["my-server_sometool"], ruleset)
    expect(result.has("my-server_sometool")).toBe(true)
  })
})
