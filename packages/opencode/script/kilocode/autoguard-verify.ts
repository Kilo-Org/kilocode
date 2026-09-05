import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { run, prepareCommand, type Profile } from "@kilocode/sandbox"

// Host-only oracle launcher. The agent never chooses these verification arguments.
const input = JSON.parse(process.argv[2]) as { cwd: string; argv: string[] }
const cwd = realpathSync(input.cwd)
const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), "autoguard-verification-")))
mkdirSync(temporary, { recursive: true, mode: 0o700 })
const profile: Profile = {
  filesystem: {
    allowWrite: [{ path: temporary, kind: "subtree" }],
    denyWrite: [],
    denyNames: [".git"],
    temporaryDirectory: temporary,
  },
  network: { mode: "deny", allowedHosts: [] },
  environment: {
    deny: ["AUTOGUARD_L1_API_KEY", "OPENROUTER_API_KEY", "PYTHONPATH", "PYTHONSTARTUP", "NODE_OPTIONS"],
    set: {
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTEST_ADDOPTS: "-p no:cacheprovider",
      PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
    },
  },
}
try {
  process.exitCode = await Effect.runPromise(
    Effect.scoped(
      run(
        profile,
        Effect.gen(function* () {
          const command = yield* prepareCommand(ChildProcess.make(input.argv[0], input.argv.slice(1)), cwd, process.env)
          const child = Bun.spawn([command.command, ...command.args], {
            cwd,
            env: command.options.env,
            stdout: "inherit",
            stderr: "inherit",
          })
          return yield* Effect.promise(() => child.exited)
        }),
      ),
    ),
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
