// kilocode_change - new file
import { expect, test } from "bun:test"
import { cliCommand } from "../../src/cli/cmd/pr"

test("cliCommand uses the current script when argv[1] is a file path", () => {
  const result = cliCommand({
    execPath: "/usr/bin/node",
    argv: ["/usr/bin/node", "/tmp/kilo.js", "pr", "1"],
    exists: (file) => file === "/tmp/kilo.js",
  })

  expect(result).toEqual(["/usr/bin/node", "/tmp/kilo.js"])
})

test("cliCommand falls back to execPath when argv[1] is a subcommand", () => {
  const result = cliCommand({
    execPath: "/usr/local/bin/kilo",
    argv: ["/usr/local/bin/kilo", "pr", "1"],
    exists: () => false,
  })

  expect(result).toEqual(["/usr/local/bin/kilo"])
})

test("cliCommand falls back to execPath when argv[1] is missing", () => {
  const result = cliCommand({
    execPath: "/usr/local/bin/kilo",
    argv: ["/usr/local/bin/kilo"],
    exists: () => false,
  })

  expect(result).toEqual(["/usr/local/bin/kilo"])
})
