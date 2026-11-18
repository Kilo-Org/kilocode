import { expect, test } from "bun:test"
import { shellCommand } from "../src/shell"

test("wraps a shell launch once", () => {
  expect(shellCommand({ command: "echo a b", args: ["c'd"], cwd: "/", environment: {}, shell: true })).toEqual({
    command: "/bin/sh",
    args: ["-c", "echo a b 'c'\\''d'"],
  })
})

test("uses the requested shell", () => {
  expect(shellCommand({ command: "true", args: [], cwd: "/", environment: {}, shell: "/bin/zsh" })).toEqual({
    command: "/bin/zsh",
    args: ["-c", "true"],
  })
})

test("passes a direct launch through unchanged", () => {
  const args = ["--flag", "value with space"]
  expect(shellCommand({ command: "/bin/echo", args, cwd: "/", environment: {} })).toEqual({
    command: "/bin/echo",
    args,
  })
})
