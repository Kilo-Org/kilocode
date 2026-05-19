import { test, expect } from "bun:test"
import { prefix } from "../../src/permission/arity"

test("arity 1 - unknown commands default to first token", () => {
  expect(prefix(["unknown", "command", "subcommand"])).toEqual(["unknown"])
  expect(prefix(["touch", "foo.txt"])).toEqual(["touch"])
})

test("arity 2 - two token commands", () => {
  expect(prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"])
  expect(prefix(["docker", "run", "nginx"])).toEqual(["docker", "run"])
})

test("arity 3 - three token commands", () => {
  expect(prefix(["aws", "s3", "ls", "my-bucket"])).toEqual(["aws", "s3", "ls"])
  expect(prefix(["npm", "run", "dev", "script"])).toEqual(["npm", "run", "dev"])
})

test("longest match wins - nested prefixes", () => {
  expect(prefix(["docker", "compose", "up", "service"])).toEqual(["docker", "compose", "up"])
  expect(prefix(["consul", "kv", "get", "config"])).toEqual(["consul", "kv", "get"])
})

test("exact length matches", () => {
  expect(prefix(["git", "checkout"])).toEqual(["git", "checkout"])
  expect(prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"])
})

test("edge cases", () => {
  expect(prefix([])).toEqual([])
  expect(prefix(["single"])).toEqual(["single"])
  expect(prefix(["git"])).toEqual(["git"])
})
