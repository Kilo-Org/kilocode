import { expect, test } from "bun:test"
import { requireRuntime } from "../src/runtime"

for (const version of ["1.3.14", "1.2.0"]) {
  test(`rejects unsupported Bun ${version}`, () => {
    expect(() => requireRuntime(version)).toThrow("requires Bun 1.4.0 or newer")
  })
}

for (const version of ["1.4.0", "1.4.1", "2.0.0"]) {
  test(`accepts compatible Bun ${version}`, () => {
    expect(() => requireRuntime(version)).not.toThrow()
  })
}
