// The read-only bash rulesets deny operators with globs like `*>*` and `*|*`
// that match anywhere in the permission pattern. The shell tool now renders
// that pattern from the tree-sitter parse and masks operator characters only
// where the parser proves they are inert (quoted strings, escaped words,
// heredoc bodies, /dev/null redirects, fd duplication). These tests drive the
// real ShellPermission scanner so quoting is decided by the parser, not by a
// second hand-written lexer.

import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { hardenExplore, patchAgents } from "../../../src/kilocode/agent"
import { Permission } from "../../../src/permission"
import { ShellPermission } from "../../../src/tool/shell"
import { SessionID, MessageID } from "../../../src/session/schema"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdir } from "../../fixture/fixture"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  AppNodeBuilder.build(FSUtil.node),
  testInstanceStoreLayer,
)

type Request = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">

async function patterns(dir: string, command: string, shell = "bash") {
  const requests: Request[] = []
  const ctx = {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "explore",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req: Request) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  await Effect.runPromise(
    provideInstance(dir)(
      Effect.gen(function* () {
        const permission = yield* ShellPermission
        yield* permission.ask(ctx, { command, cwd: dir, shell, description: "test", escalate: false })
      }),
    ).pipe(Effect.provide(layer)),
  )
  return requests.filter((req) => req.permission === "bash").flatMap((req) => req.patterns)
}

function rules() {
  const items: Parameters<typeof patchAgents>[0] = Object.fromEntries(
    ["build", "plan", "explore"].map((name) => [name, { name, mode: "primary", options: {}, permission: [] }]),
  )
  patchAgents(items, [], [], { mcpRules: {}, defaultsPatch: [], board: false, autonomous: false }, "/repo", [])
  hardenExplore("explore", items.explore, [])
  return { plan: items.plan.permission, explore: items.explore.permission }
}

const ruleset = rules()

// A command runs only when every pattern the scanner asks with is allowed.
function decide(found: string[], permission: Permission.Ruleset) {
  const actions = found.map((pattern) => Permission.resolve("bash", pattern, permission).action)
  return actions.every((action) => action === "allow") ? "allow" : "deny"
}

afterEach(async () => {
  await disposeAllInstances()
})

const q = "'"
const allowed = [
  "cat file.txt",
  "cat file.txt 2>/dev/null",
  "cat file.txt 2> /dev/null",
  "cat file.txt >/dev/null",
  "cat file.txt > /dev/null",
  "cat file.txt >>/dev/null",
  "cat file.txt &>/dev/null",
  "cat file.txt >| /dev/null",
  "cat file.txt 2>&1",
  "cat file.txt 1>&2",
  "cat file.txt 2>&-",
  "cat file.txt </dev/null",
  "cat file.txt < input.txt",
  "wc -l < file 2>/dev/null",
  'cat "file with spaces" 2>/dev/null',
  "ls -la 2>/dev/null",
  'grep -rn "=>" packages/opencode/src',
  'grep -rn "->" src',
  'grep -rn "a|b" src',
  'grep -rn "a;b" src',
  'grep -rn "a&b" src',
  'grep -rn "List<T>" src',
  'grep "a\\|b" file',
  "grep a\\|b file",
  "grep 'a|b' src",
  "grep 'a$(b)' file",
  'grep "a\\$(b)" file',
  'cat "a; rm -rf x"',
  'rg "foo|bar" src',
  'rg "Promise<T>" src',
  "git log -S 'x=>y' --oneline",
  "git log --grep 'a|b'",
  "git log --all --oneline --grep='icon button\\|icon-button\\|IconButton' -i -30",
  'git log --grep "a\\|b"',
  "git show HEAD:file 2>/dev/null",
  "git diff main...HEAD --name-only",
  'echo "a>b"',
  'echo "a|b"',
  "echo 'x->y'",
  'echo "line1\nline2"',
  "cat $" + q + "a>b" + q,
  "cat <<'EOF'\nhello | world\nEOF",
  "cat <<EOF\nplain text > here\nEOF",
  'jq \'.data[] | select(.id == "x")\' file.json',
  'rg -n "app.exit|permission.prompt.fullscreen" packages/tui/src/config/keybind.ts',
  'rg -l -i "permission" packages/tui/test packages/opencode/test/cli 2>/dev/null',
  'grep -rn "synthetic" packages/sdk/js/src/v2/gen/types.gen.ts 2>/dev/null',
  "ls packages/core/src/ 2>/dev/null",
  // Real operators between read-only commands are split by the parser.
  "ls packages/ | head -40",
  "git status --short && git log --oneline -3",
  'cat "${x:-"' + q + '"}" ; echo P',
]

const denied = [
  "cat file.txt > out.txt",
  "cat file.txt >> out.txt",
  "cat file.txt 2> err.log",
  "cat file.txt >| out.txt",
  "cat file.txt > /dev/nullfoo",
  "cat file.txt > /dev/null/../etc/hosts",
  "cat file.txt > out.txt 2>/dev/null",
  "cat file.txt 2>/dev/null > out.txt",
  "cat file.txt 2>&1 > out.txt",
  "cat file.txt | tee out.txt",
  "cat file.txt; rm -rf x",
  "cat file.txt && rm -rf x",
  "cat $(rm -rf x)",
  "cat `rm -rf x`",
  "cat <(rm -rf x)",
  "cat > file.txt <<EOF\ntext\nEOF",
  "cat <<EOF\n$(rm -rf x)\nEOF",
  "rm file.txt 2>/dev/null",
  "printf 'x->y\\n'",
  'python -c "print(1)"',
  "bash -c 'rm -rf x'",
  "node -e \"require('fs')\"",
  'grep "a$(rm x)" file',
  "find . 2>/dev/null",
  "git diff main...HEAD > /tmp/scoped.diff",
  "git ls-files > /dev/null 2>/tmp/lsfiles.txt",
  "git log --reverse --format='%h %s' $(git merge-base origin/main HEAD)..HEAD",
  "bun -e 'console.log(\"x => \" + import.meta.resolve(\"y\"))'",
  "python3 -c 'import json; print(1)'",
  'ls packages/kilo-ui/src/components/ | grep -iE "text|input" | awk 1',
  // Quoting the parser resolves correctly where a text scanner did not.
  "cat $" + q + "a\\" + q + "b" + q + " > out.txt",
  "cat $" + q + "a\\" + q + "b" + q + " | tee out.txt",
  'cat "${x:-"' + q + '"}" ; rm -rf x',
  'cat "${x:-"' + q + '"}" > /tmp/x',
]

describe("shell pattern masking", () => {
  test("masks only inert operators and keeps real redirects verbatim", async () => {
    await using tmp = await tmpdir()
    expect(await patterns(tmp.path, 'grep "a|b" f 2>/dev/null')).toEqual(['grep "a_b" f 2_/dev/null'])
    expect(await patterns(tmp.path, "cat f 2>&1")).toEqual(["cat f 2__1"])
    expect(await patterns(tmp.path, "grep a\\|b f")).toEqual(["grep a\\_b f"])
    expect(await patterns(tmp.path, "echo test > output.txt")).toEqual(["echo test > output.txt"])
    expect(await patterns(tmp.path, "cat $" + q + "a\\" + q + "b" + q + " > out.txt")).toEqual([
      "cat _" + q + "a\\" + q + "b" + q + " > out.txt",
    ])
    expect(await patterns(tmp.path, "cat <<'EOF'\na|b\nEOF")).toEqual(["cat <<'EOF'_a_b_EOF"])
  })

  test("falls back to the raw source for non-bash grammars", async () => {
    await using tmp = await tmpdir()
    // cmd.exe does not treat single quotes as quoting, so the bash masking must not apply.
    const command = "echo 'x&del important.txt '"
    expect(await patterns(tmp.path, command, "cmd")).toEqual([command])
    expect(decide(await patterns(tmp.path, command, "cmd"), ruleset.explore)).toBe("deny")
    expect(decide(await patterns(tmp.path, command, "bash"), ruleset.explore)).toBe("allow")
  })

  for (const command of allowed) {
    test(`allows read-only: ${JSON.stringify(command)}`, async () => {
      await using tmp = await tmpdir()
      const found = await patterns(tmp.path, command)
      expect(found.length, command).toBeGreaterThan(0)
      expect(decide(found, ruleset.explore), command).toBe("allow")
      expect(decide(found, ruleset.plan), command).toBe("allow")
    })
  }

  for (const command of denied) {
    test(`denies: ${JSON.stringify(command)}`, async () => {
      await using tmp = await tmpdir()
      const found = await patterns(tmp.path, command)
      expect(found.length, command).toBeGreaterThan(0)
      expect(decide(found, ruleset.explore), command).toBe("deny")
      expect(decide(found, ruleset.plan), command).toBe("deny")
    })
  }
})
