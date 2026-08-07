import { test, expect, describe } from "bun:test"
import { Permission } from "../../src/permission"
import { readOnlyBash } from "../../src/kilocode/agent"

/** Build the Ask agent ruleset without MCP servers */
function askRuleset() {
  return Permission.fromConfig({
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
    codebase_search: "allow",
  })
}

/** Build the Ask agent ruleset WITH MCP servers and optional user config */
function askRulesetWithMcp(servers: string[], user: Permission.Ruleset = []) {
  const mcpRules: Record<string, "allow" | "ask" | "deny"> = {}
  for (const key of servers) {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, "_")
    mcpRules[sanitized + "_*"] = "ask"
  }
  // Mirrors Ask agent merge order: guard, user config, Bash guard, user denies.
  return Permission.merge(
    Permission.fromConfig({
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
      codebase_search: "allow",
      ...mcpRules,
    }),
    user,
    Permission.fromConfig({ bash: readOnlyBash }),
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
        const result = Permission.evaluate("bash", cmd, ruleset)
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
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("allow")
      })
    }
  })

  describe("denied output redirection and writer flags", () => {
    const denied = [
      "echo hi > file",
      "echo hi >> file",
      "echo hi | tee file",
      "echo hi; touch file",
      "echo hi && touch file",
      "echo $(touch file)",
      "echo `touch file`",
      "cat a > b",
      "jq . a.json > b.json",
      "sort names.txt -o names.txt",
      "sort --output=names.txt names.txt",
      "sort names.txt --output=names.txt",
      "echo ok\ntouch ask-bypass.txt",
      "cat <(touch ask-bypass.txt)",
      // Exec-via-flag escapes on otherwise read-only commands
      'sort -S 1b --compress-program "sh" names.txt',
      "sort --compress-program=sh names.txt",
      "sort --files0-from=list names.txt",
      "rg --pre sh -e . names.txt",
      "rg --pre=sh -e . names.txt",
      "ag --pager sh foo",
      "man -P sh ls",
      "man -Psh ls",
      "man --pager=sh ls",
    ]

    for (const cmd of denied) {
      test(`"${cmd}" → deny`, () => {
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
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
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
      })
    }
  })

  describe("denied write/execute commands", () => {
    const denied = [
      "touch newfile.ts",
      "mkdir src/new",
      "rmdir src/old",
      "cp a.ts b.ts",
      "mv old.ts new.ts",
      "rm -rf /",
      "install source target",
      "ln -s source target",
      "chmod +x script.sh",
      "chown user file",
      "truncate -s 0 file",
      "tee file",
      "dd if=input of=output",
      "sed -i -e 's/old/new/' file",
      "sed -i.bak -e 's/old/new/' file",
      "sed -Ei.bak -e 's/old/new/' file",
      "sed -e 's/old/new/' -i file",
      "sed --in-place=.bak -e 's/old/new/' file",
    ]

    for (const cmd of denied) {
      test(`"${cmd}" → deny`, () => {
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
      })
    }
  })

  describe("unclassified commands require approval", () => {
    const asked = [
      "find . -print",
      "tsc --noEmit",
      "npm view react version",
      "python3 -c 'print(1)'",
      "node --version",
      "curl https://example.com",
      "sed -n '1,5p' README.md",
    ]

    for (const cmd of asked) {
      test(`"${cmd}" → ask`, () => {
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("ask")
      })
    }
  })

  test("gh commands → ask", () => {
    expect(Permission.evaluate("bash", "gh pr view 123", ruleset).action).toBe("ask")
    expect(Permission.evaluate("bash", "gh issue list", ruleset).action).toBe("ask")
    expect(Permission.evaluate("bash", "gh api repos/org/repo", ruleset).action).toBe("ask")
  })
})

describe("Ask agent tool disabled checks", () => {
  const ruleset = askRuleset()

  test("bash tool is NOT disabled (has specific allow rules after deny)", () => {
    const result = Permission.disabled(["bash"], ruleset)
    expect(result.has("bash")).toBe(false)
  })

  test("allowed tools are not disabled", () => {
    const tools = ["read", "grep", "glob", "list", "question", "webfetch", "websearch", "codebase_search"]
    const result = Permission.disabled(tools, ruleset)
    for (const tool of tools) {
      expect(result.has(tool)).toBe(false)
    }
  })

  test("edit tools are disabled", () => {
    const tools = ["edit", "write", "patch"]
    const result = Permission.disabled(tools, ruleset)
    for (const tool of tools) {
      expect(result.has(tool)).toBe(true)
    }
  })

  test("task tool is disabled", () => {
    const result = Permission.disabled(["task"], ruleset)
    expect(result.has("task")).toBe(true)
  })

  test("todowrite and todoread are disabled", () => {
    const result = Permission.disabled(["todowrite", "todoread"], ruleset)
    expect(result.has("todowrite")).toBe(true)
    expect(result.has("todoread")).toBe(true)
  })
})

describe("Ask agent MCP permissions", () => {
  test("MCP tools not disabled when servers configured", () => {
    const ruleset = askRulesetWithMcp(["my-server", "another_server"])
    const result = Permission.disabled(["my-server_sometool", "another_server_listthing"], ruleset)
    expect(result.has("my-server_sometool")).toBe(false)
    expect(result.has("another_server_listthing")).toBe(false)
  })

  test("MCP tools evaluate to ask", () => {
    const ruleset = askRulesetWithMcp(["my-server"])
    const result = Permission.evaluate("my-server_read_file", "*", ruleset)
    expect(result.action).toBe("ask")
  })

  test("user config allow overrides MCP ask rules", () => {
    const allow = Permission.fromConfig({ "my-server_read_file": "allow" })
    const ruleset = askRulesetWithMcp(["my-server"], allow)
    const result = Permission.evaluate("my-server_read_file", "*", ruleset)
    expect(result.action).toBe("allow")
  })

  test("MCP tools disabled without server config", () => {
    const ruleset = askRuleset()
    const result = Permission.disabled(["my-server_sometool"], ruleset)
    expect(result.has("my-server_sometool")).toBe(true)
  })

  test("server names with special characters are sanitized", () => {
    const ruleset = askRulesetWithMcp(["my.special server!"])
    // "my.special server!" → "my_special_server_"
    const result = Permission.disabled(["my_special_server__sometool"], ruleset)
    expect(result.has("my_special_server__sometool")).toBe(false)

    const eval_ = Permission.evaluate("my_special_server__sometool", "*", ruleset)
    expect(eval_.action).toBe("ask")
  })

  test("MCP rules don't interfere with built-in tool permissions", () => {
    const ruleset = askRulesetWithMcp(["server1"])
    // Built-in tools should still work normally
    expect(Permission.evaluate("read", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "ls -la", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "git commit -m test", ruleset).action).toBe("deny")

    // Edit tools should still be disabled
    const disabled = Permission.disabled(["edit", "write"], ruleset)
    expect(disabled.has("edit")).toBe(true)
    expect(disabled.has("write")).toBe(true)
  })

  test("user config deny overrides MCP ask rules", () => {
    const deny = Permission.fromConfig({ "my-server_*": "deny" })
    const ruleset = askRulesetWithMcp(["my-server"], deny)
    // User explicitly denied this server — should stay denied
    const result = Permission.disabled(["my-server_sometool"], ruleset)
    expect(result.has("my-server_sometool")).toBe(true)
  })
})
