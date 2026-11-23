import { test, expect, describe } from "bun:test"
import { Permission } from "../../src/permission"
import { readOnlyBash } from "../../src/kilocode/agent"
import { pattern } from "../../src/kilocode/mcp/tool-id"

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
  })
}

/** Build the Ask agent ruleset WITH MCP servers and optional user config */
function askRulesetWithMcp(servers: string[], user: Permission.Ruleset = []) {
  const mcpRules: Record<string, "allow" | "ask" | "deny"> = {}
  for (const key of servers) {
    mcpRules[pattern(key)] = "ask"
  }
  // Mirrors Ask agent merge order: defaults, ask-specific guard, user config, user denies last.
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
      ...mcpRules,
    }),
    user,
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
        const result = Permission.evaluate("bash", cmd, ruleset)
        expect(result.action).toBe("deny")
      })
    }
  })

  test("read-only gh commands allow while gh api asks", () => {
    expect(Permission.evaluate("bash", "gh pr view 123", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "gh issue list", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "gh api repos/org/repo", ruleset).action).toBe("ask")
  })

  // An environment file gets the same level from the shell as from the read rule.
  // A reader's file counts at any operand position, a searcher's once the name
  // follows its search term, and a git reader's inside the revision spec.
  describe("environment files keep the read level", () => {
    const cases: [string, "allow" | "ask"][] = [
      // A reader: any operand position, a glob, a quoted operand, a nested path.
      ["cat .env", "ask"],
      ["cat prod.env", "ask"],
      ["cat config/prod.env", "ask"],
      ["cat .env*", "ask"],
      ['cat ".env"', "ask"],
      ["head -n5 .env", "ask"],
      ["tail -f .env", "ask"],
      ["less .env", "ask"],
      ["diff .env src/index.ts", "ask"],
      ["sort .env", "ask"],
      ["uniq .env", "ask"],
      ["cut -d= -f1 .env", "ask"],
      ["jq . .env", "ask"],
      ["cat .env notes.txt", "ask"],
      ["head -n 5 .env.production", "ask"],
      ["diff a.txt .env.local", "ask"],
      ["cat apps/web/.env.local", "ask"],
      // The sample file is allowed only as the lone operand. A second operand and
      // a nested path state their own level: a rule naming them needs a wildcard
      // before the path.
      ["cat .env.example", "allow"],
      ["diff .env .env.example", "ask"],
      ["cat .env.example .env", "ask"],
      ["cat -n .env .env.example", "ask"],
      ["cat -n .env config/.env.example", "ask"],
      ["cat config/.env.example", "ask"],
      // A searcher: the environment file is an operand, the pattern is first.
      ["grep -rn KEY prod.env", "ask"],
      ["rg -n SECRET prod.env", "ask"],
      ["ag KEY prod.env", "ask"],
      ["grep -n KEY .env", "ask"],
      ["grep -rn KEY .env.local", "ask"],
      ["grep x .env src/", "ask"],
      ["rg KEY config/.env src/", "ask"],
      ["grep -n KEY app/.env.local src/", "ask"],
      ["grep -n KEY .env .env.example", "ask"],
      ["grep -n KEY .env config/.env.example", "ask"],
      // A search term that merely contains `.env` is not a file read, and a bare
      // term that reads like a file name is the searcher's pattern, so it is not
      // a read of that file either.
      ["grep process.env", "allow"],
      ["rg -n process.env src/foo.ts", "allow"],
      ["grep .env", "allow"],
      ["rg .env", "allow"],
      ["ag .env", "allow"],
      // A last argument that only ends in `.env` is treated as a file name, so a
      // search term in that position gets the same level; a path operand after it
      // does not.
      ["rg -n process.env", "ask"],
      ["grep -rn process.env", "ask"],
      // A stream filter's input redirect follows the same rule.
      ["tr -d ',' < .env", "ask"],
      ["tr -d ',' < .env.local", "ask"],
      ["tr -d ','", "allow"],
      ["tr -d ',' < notes.txt", "allow"],
      // A process environment dump.
      ["printenv", "ask"],
      ["printenv HOME", "ask"],
      // A git reader: the environment file sits in the revision spec, and the
      // sample asks there too because a spec cannot be restricted to one operand.
      ["git show HEAD:.env", "ask"],
      ["git cat-file -p HEAD:.env", "ask"],
      ["git diff HEAD~1 .env", "ask"],
      ["git log -p -- .env", "ask"],
      ["git blame .env", "ask"],
      ["git diff .env README.md", "ask"],
      ["git show HEAD -- .env src/index.ts", "ask"],
      ["git log -p -- .env src/index.ts", "ask"],
      ["git blame .env src/index.ts", "ask"],
      ["git show HEAD:.env HEAD:.env.example", "ask"],
      ["git show HEAD:.env.example", "ask"],
      ["git diff HEAD~1 .env .env.example", "ask"],
      ["git show HEAD", "allow"],
      ["git diff HEAD~1", "allow"],
      ["git log --oneline", "allow"],
      ["git blame src/index.ts", "allow"],
    ]

    for (const [cmd, action] of cases) {
      test(`"${cmd}" → ${action}`, () => {
        expect(Permission.evaluate("bash", cmd, ruleset).action).toBe(action)
      })
    }

    test("ordinary reads keep their allow", () => {
      expect(Permission.evaluate("bash", "cat README.md", ruleset).action).toBe("allow")
      expect(Permission.evaluate("bash", "diff a.txt b.txt", ruleset).action).toBe("allow")
      // A search for the identifier is not a read of an environment file.
      expect(Permission.evaluate("bash", "rg process.env", ruleset).action).toBe("allow")
      expect(Permission.evaluate("bash", "grep -rn process.env src", ruleset).action).toBe("allow")
    })
  })
})

describe("Ask agent tool disabled checks", () => {
  const ruleset = askRuleset()

  test("bash tool is NOT disabled (has specific allow rules after deny)", () => {
    const result = Permission.disabled(["bash"], ruleset)
    expect(result.has("bash")).toBe(false)
  })

  test("allowed tools are not disabled", () => {
    const tools = ["read", "grep", "glob", "list", "question", "webfetch", "websearch"]
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
