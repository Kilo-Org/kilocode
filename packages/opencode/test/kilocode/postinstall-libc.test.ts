import { describe, it, expect } from "bun:test"
import childProcess from "child_process"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mockPackageDir = path.resolve(__dirname, "../../../../test-13282/package")
const postinstall = path.resolve(mockPackageDir, "postinstall.mjs")

function runPostinstall(env: Record<string, string>): {
  exitCode: number
  stdout: string
  stderr: string
} {
  const result = childProcess.spawnSync(
    process.execPath,
    ["--experimental-vm-modules", postinstall],
    {
      cwd: mockPackageDir,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10000,
    },
  )
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

describe("postinstall libc guard (#13282)", () => {
  it("should NOT attempt to install musl package on a glibc system", () => {
    const result = runPostinstall({
      KILO_TEST_PLATFORM: "linux",
      KILO_TEST_ARCH: "arm64",
      KILO_TEST_IS_MUSL: "false",
      KILO_TEST_BINARY_WORKS: "false",
    })

    expect(result.stdout + result.stderr).toContain("skipping @kilocode/cli-linux-arm64-musl: incompatible libc")
  })

  it("should skip glibc package on a musl system", () => {
    const result = runPostinstall({
      KILO_TEST_PLATFORM: "linux",
      KILO_TEST_ARCH: "arm64",
      KILO_TEST_IS_MUSL: "true",
      KILO_TEST_BINARY_WORKS: "false",
    })

    expect(result.stdout + result.stderr).toContain("skipping @kilocode/cli-linux-arm64: incompatible libc")
  })
})
