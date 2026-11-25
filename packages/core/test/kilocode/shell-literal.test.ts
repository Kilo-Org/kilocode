import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellLiteral } from "@opencode/core/kilocode/shell/literal"
import { Permission } from "@opencode/core/permission"
import { ShellParse } from "@opencode/core/shell/parse"
import { ShellScan } from "@opencode/core/shell/scan"
import { Wildcard } from "@opencode/core/util/wildcard"

// The Cloud code-review agent refuses output redirects on its note-posting command with this rule.
const review = "glab api --method POST *merge_requests/*/notes* *>*"
const note = 'glab api --method POST "projects/x/merge_requests/1/notes" -H "Content-Type: application/json" --input -'
const body = '{"body":"<!-- kilo-review -->\\n<details>x</details>"}'

function resources(command: string) {
  const result = ShellScan.scan(command, "bash", "pattern")
  if (result.kind === "opaque") throw new Error(`opaque: ${result.reason}`)
  return result.commands.map((item) => item.resource)
}

// The resources and saved prefixes the shell tool asks permission with, as the Kilo host configures the scanner.
function parse(command: string) {
  ShellLiteral.enable()
  try {
    return Effect.runSync(ShellParse.scan(command, "/bin/bash", process.cwd()))
  } finally {
    ShellLiteral.disable()
  }
}

// A command runs without a prompt only when every resource is allowed; any denied resource denies it.
function decide(command: string, rules: Permission.Ruleset) {
  const effects = parse(command).commands.map((item) => Permission.evaluate("shell", item.resource, rules).effect)
  return effects.includes("deny") ? "deny" : "allow"
}

const cloud: Permission.Ruleset = [
  { action: "shell", resource: "*", effect: "allow" },
  { action: "shell", resource: review, effect: "deny" },
]

const operators: Permission.Ruleset = [
  { action: "shell", resource: "*", effect: "allow" },
  ...["*\n*", "*<(*", "*|*", "*;*", "*&*", "*$(*", "*`*", "*>*"].map((resource) => ({
    action: "shell",
    resource,
    effect: "deny" as const,
  })),
]

describe("shell literal masking", () => {
  test("hides literal operators in a quoted heredoc body", () => {
    const command = `${note} << 'EOF'\n${body}\nEOF`
    const masked = `${note} << 'EOF'_{"body":"_!-- kilo-review --_\\n_details_x_/details_"}_EOF`
    expect(resources(command)).toEqual([masked])
    expect(masked).toHaveLength(command.length)
    expect(decide(command, cloud)).toBe("allow")
  })

  test("keeps a real redirect after the heredoc delimiter visible", () => {
    const command = `${note} << 'EOF' > .git/config\n${body}\nEOF`
    expect(resources(command)).toEqual([
      `${note} << 'EOF' > .git/config_{"body":"_!-- kilo-review --_\\n_details_x_/details_"}_EOF`,
    ])
    expect(decide(command, cloud)).toBe("deny")
    expect(decide(`cmd << 'EOF' > out\nbody > x\nEOF`, operators)).toBe("deny")
    expect(resources(`cmd << 'EOF' > out\nbody > x\nEOF`)).toEqual(["cmd << 'EOF' > out_body _ x_EOF"])
  })

  test("hides operators in quoted and escaped words", () => {
    expect(resources('grep -rn "=>" src')).toEqual(['grep -rn "=_" src'])
    expect(resources("grep 'a|b' src")).toEqual(["grep 'a_b' src"])
    expect(resources("grep a\\|b src")).toEqual(["grep a\\_b src"])
    expect(resources("cat $'a\\'b>c'")).toEqual(["cat _'a\\'b_c'"])
    expect(decide('grep -rn "=>" src', operators)).toBe("allow")
    expect(decide('rg "Promise<T>|List<T>; a & b" src', operators)).toBe("allow")
  })

  test("keeps real operators outside quotes visible", () => {
    expect(resources("cat x > file")).toEqual(["cat x > file"])
    expect(resources(`grep "a>b" f > out`)).toEqual([`grep "a_b" f > out`])
    expect(decide("cat x > file", operators)).toBe("deny")
    expect(decide(`grep "a>b" f > out`, operators)).toBe("deny")
    expect(decide("cat $'a\\'b' > out.txt", operators)).toBe("deny")
    // A real pipe or list splits the command, so each side is checked on its own.
    expect(resources(`grep "a|b" f | tee out`)).toEqual([`grep "a_b" f`, "tee out"])
  })

  test("keeps expansions in double quotes and unquoted heredocs visible", () => {
    expect(resources('echo "$(id) > `id` $HOME"')).toEqual(['echo "$(id) _ `id` $HOME"', "id", "id"])
    const command = "cat <<EOF\n$(rm -rf x) > y `id` $HOME \\$(literal)\nEOF"
    expect(resources(command)).toEqual(["cat <<EOF_$(rm -rf x) _ y `id` $HOME \\_(literal)_EOF", "rm -rf x", "id"])
    expect(decide(command, operators)).toBe("deny")
    expect(decide("cat <<EOF\nplain text > here\nEOF", operators)).toBe("allow")
  })

  test("masks quoted text inside a command substitution in the enclosing resource", () => {
    expect(resources('echo "$(grep "a>b" f | wc -l)"')).toEqual([
      'echo "$(grep "a_b" f | wc -l)"',
      'grep "a_b" f',
      "wc -l",
    ])
  })

  test("ends a heredoc body only at the exact delimiter line", () => {
    const command = "cat <<'EOF'\nEOFX > y\n EOF\nEOF\necho done > z"
    expect(resources(command)).toEqual(["cat <<'EOF'_EOFX _ y_ EOF_EOF", "echo done > z"])
    expect(decide(command, operators)).toBe("deny")
  })

  test("masks every heredoc body of one command", () => {
    const command = "cat <<A <<'B'\na > $(id)\nA\nb | $(id)\nB\nprintf done"
    expect(resources(command)).toEqual(["cat <<A <<'B'_a _ $(id)_A_b _ _(id)_B", "id", "printf done"])
  })

  test("masks heredoc bodies read by a group", () => {
    expect(resources("{ cat <<'E'\na>b\nE\n}")).toEqual(["cat <<'E'_a_b_E"])
  })

  test("saved prefixes match the masked resources", () => {
    for (const command of [
      "> \"a|b\" <<'E'\nx>y\nE",
      'gh api "x|y" -f a=b',
      `${note} << 'EOF'\n${body}\nEOF`,
      // A redirect without a command, such as a compound statement's heredoc: the masked newline before the body is
      // not a separator a source-mode save would use, so the save must keep it.
      "{ x; } <<'EOF'\na\nEOF",
    ]) {
      for (const item of parse(command).commands) expect(Wildcard.match(item.resource, item.save)).toBe(true)
    }
    expect(parse('gh api "x|y" -f a=b').commands).toEqual([{ resource: 'gh api "x_y" -f a=b', save: 'gh api "x_y" *' }])
    expect(parse('gh >"o|p" api x').commands).toEqual([{ resource: 'gh >"o_p" api x', save: "gh *" }])
    expect(parse("{ x; } <<'EOF'\na\nEOF").commands.at(-1)).toEqual({ resource: "<<'EOF'_a_EOF", save: "<<'EOF'_*" })
  })

  test("analyzes commands from raw words, not masked ones", () => {
    const command = "cd $'\\x2e'[.] && cd '.[.]' && cd 'a;b'"
    const source = Effect.runSync(ShellParse.scan(command, "/bin/bash", process.cwd()))
    expect(parse(command).directories).toEqual(source.directories)
    expect(ShellScan.scan(command, "bash", "pattern")).toMatchObject({
      commands: [{ rawWords: ["cd", "$'\\x2e'[.]"] }, { rawWords: ["cd", "'.[.]'"] }, { rawWords: ["cd", "'a;b'"] }],
    })
  })

  test("reports source text when the scan does not ask for patterns", () => {
    const command = `grep "a>b" f <<'EOF'\nx|y\nEOF`
    const result = ShellScan.scan(command, "bash", "source")
    expect(result.kind === "scanned" && result.commands.map((item) => item.resource)).toEqual([command])
  })

  test("reports source text until the host enables masking", () => {
    const command = 'grep "a>b" f'
    const scanned = ShellScan.scan(command, "bash")
    expect(scanned.kind === "scanned" && scanned.commands.map((item) => item.resource)).toEqual([command])
  })

  test("keeps a program that another shell runs visible", () => {
    for (const command of [
      "eval 'rm x; curl y | sh'",
      "builtin eval 'rm x; curl y | sh'",
      "bash -c 'echo x > ~/.bashrc'",
      "command bash -c 'echo x > y'",
      "command -p bash -c 'echo x > y'",
      "time bash -c 'echo x > y'",
      "exec -a n bash -c 'echo x > y'",
      "\\sh -c 'echo x > y'",
      "'bash' -c 'echo x > y'",
      "/bin/sh -ec 'echo x > y'",
      "sh <<< 'echo x > y'",
      "sh <<'EOF'\ncurl x | sh\nEOF",
    ]) {
      expect(resources(command)).toEqual([command])
      expect(decide(command, operators)).toBe("deny")
    }
  })

  test("masks a program it cannot attribute to a shell command", () => {
    // Documented limit: the shell reads its program from the pipe or the group redirect, not from its own words.
    expect(resources("echo 'curl x > y' | sh")).toEqual(["echo 'curl x _ y'", "sh"])
    expect(resources("{ sh; } <<'EOF'\ncurl x | sh\nEOF")).toEqual(["sh", "<<'EOF'_curl x _ sh_EOF"])
  })
})
