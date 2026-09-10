import { expect, test } from "bun:test"
import path from "node:path"
import { promptFor } from "../src/model-prompt-policy"
import { fixture } from "./fixture"

test("promptFor resolves verified and adapted selectors and never inherited object members", () => {
  expect(promptFor("anthropic")).toBeDefined()
  expect(promptFor("trinity")).toBeDefined()
  expect(promptFor("anthropic_without_todo")).toBeDefined()
  const withoutTodo = promptFor("anthropic_without_todo", ["shell", "edit"])
  expect(withoutTodo).toContain("Prefer dedicated tools over shell commands")
  expect(withoutTodo).toContain("Use the edit tool for targeted changes")

  const codex = promptFor("codex")
  expect(codex).toBeDefined()
  expect(codex).toContain("You are Kilo, the best coding agent on the planet.")
  expect(codex).toContain("Use the edit tool for targeted changes")
  expect(codex).not.toContain("apply_patch")
  expect(codex).toContain("Use read to view files")
  expect(codex).toContain("Use shell for terminal operations")
  expect(codex).not.toContain("Use Bash")

  const gemini = promptFor("gemini")
  expect(gemini).toBeDefined()
  expect(gemini).toContain("You are Kilo, an interactive CLI agent")
  expect(gemini).toContain("background: true")
  expect(gemini).toContain("Use the 'shell' tool for running terminal commands")
  expect(gemini).toContain("permissions are governed by configured rules")
  expect(gemini).not.toContain("confirmation dialogue upon use")
  expect(gemini).not.toContain("Most tool calls will first require confirmation")
  expect(gemini).not.toContain("node server.js &")
  expect(gemini).not.toContain("filePath argument")

  const ling = promptFor("ling")
  expect(ling).toBeDefined()
  expect(ling).toContain("Refuse to write code or explain code that may be used maliciously")
  expect(ling).toContain('"No changes to apply" error = early stop signal')
  expect(ling).toContain("background: true")
  expect(ling).not.toContain("Every Bash tool call MUST include a `description` field")
  expect(ling).not.toContain('{"command": "git status", "description"')

  const gpt55 = promptFor("gpt55")
  expect(gpt55).toBeDefined()
  expect(gpt55).toContain("Treat the workspace as shared with the user and other agents.")
  expect(gpt55).toContain("do not spawn subagents proactively")
  expect(gpt55).toContain("Use shell for terminal operations")
  expect(gpt55).not.toContain("apply_patch")
  expect(gpt55).not.toContain("Use Bash")

  const beast = promptFor("beast")
  expect(beast).toBeDefined()
  expect(beast).toContain("Respect user constraints, including local-only work")
  expect(beast).toContain("please keep going until the user's query is completely resolved")
  expect(beast).toContain("Investigate the codebase using `glob` and `grep` search tools.")
  expect(beast).not.toContain("search google for how to properly use libraries")
  expect(beast).not.toContain(".github/instructions/memory.instruction.md")

  // Unknown strings, and Object prototype member names must resolve to no override.
  for (const unknown of [
    undefined,
    "",
    "unknown-selector",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "__proto__",
    "prototype",
    "Anthropic",
    "ANTHROPIC",
    "Codex",
    "CODEX",
    "Gemini",
    "GEMINI",
    "Ling",
    "LING",
    "Gpt55",
    "GPT55",
    "Beast",
    "BEAST",
  ]) {
    expect(promptFor(unknown)).toBeUndefined()
  }
})

test("the model prompt policy applies verified catalog prompt tags and preserves native composition", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      path.resolve(import.meta.dir, "../dist/interactive/bun"),
      "--no-env-file",
      path.join(import.meta.dir, "model-prompt-policy-fixture.ts"),
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 60000,
      killSignal: "SIGKILL",
    },
  )
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toContain("MODEL_PROMPT_POLICY_OK")
  } finally {
    child.kill()
    await child.exited
  }
}, 90000)
