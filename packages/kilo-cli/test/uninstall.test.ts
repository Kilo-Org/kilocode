import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { uninstalled } from "../src/commands/uninstall"

// `kilo2 uninstall` is the upstream handler behind the Kilo host, whose updater reports no install method
// (src/updater.ts). Each test boots the real host entry in a scratch home that holds a kilo2 installation next to a
// Kilo v1 installation, an OpenCode installation and shell rc files with their PATH lines. The handler stops the
// kilo2 background services and removes the kilo2 cache directory; data, config and state stay, and nothing outside
// the kilo2 directories changes.

const entry = path.join(import.meta.dir, "../src/index.ts")
// One transpiler cache for every host boot of this file. Bun would otherwise keep it under the scratch home
// (`~/Library/Caches/bun` on macOS), where it would count as a change outside the kilo2 directories.
const transpiled = await mkdtemp(path.join(os.tmpdir(), "kilo-uninstall-transpiler-"))
afterAll(() => rm(transpiled, { recursive: true, force: true }))

// What booting the host creates in a seeded home on this platform (a log file, empty directories, indexing
// markers), measured with a command that does nothing else. An uninstall may create these and no other entry.
const boot = { artifacts: [] as string[] }
beforeAll(async () => {
  await using install = await seed()
  const before = await snapshot(install.home)
  const result = await host(install, "debug", "paths")
  expect(result.code, result.output).toBe(0)
  boot.artifacts = added(before, await snapshot(install.home))
  expect(
    boot.artifacts.filter((file) => !/^(\.config|\.local\/share|\.local\/state|\.cache)\/kilo2\//.test(file)),
  ).toEqual([])
}, 60_000)

const summary = (install: Awaited<ReturnType<typeof seed>>) => [
  "Uninstall Kilo",
  "Installation method: unknown",
  "The following global files will be removed (shared by Kilo versions and channels):",
  `Cache: ${install.cache}`,
  `Stop background service and persistent terminals: ${install.registration}`,
  "Could not detect the installation method. Remove the installation manually after cleanup.",
]

test("a dry run lists only the kilo2 cache and service, in Kilo wording, and changes nothing", async () => {
  await using install = await seed()
  const before = await snapshot(install.home)

  const result = await host(install, "uninstall", "--dry-run")

  expect(result.code, result.output).toBe(0)
  // Every line the user reads: no package, binary or shell PATH step, and no path outside the kilo2 directories.
  expect(messages(result.output)).toEqual([...summary(install), "Dry run - no changes made", "Done"])
  expect(result.output.replaceAll(install.root, "")).not.toMatch(/opencode/i)
  await untouched(install, before)
}, 60_000)

test("a run without --force and without a terminal refuses and changes nothing", async () => {
  await using install = await seed()
  const before = await snapshot(install.home)

  const result = await host(install, "uninstall")

  expect(result.code, result.output).toBe(1)
  expect(messages(result.output)).toEqual([
    ...summary(install),
    "Use --force to uninstall without an interactive terminal, or --dry-run to preview.",
    "Failed",
  ])
  await untouched(install, before)
}, 60_000)

// Bun.spawn attaches a pseudo-terminal only on POSIX, and the confirmation prompt needs one.
test.skipIf(process.platform === "win32")(
  "an interactive run asks for confirmation, and a decline changes nothing",
  async () => {
    await using install = await seed()
    const before = await snapshot(install.home)
    const question = "Are you sure you want to uninstall?"
    const screen = { text: "", answered: false }
    const decoder = new TextDecoder()
    const finished = Promise.withResolvers<void>()

    const child = Bun.spawn([process.execPath, entry, "uninstall"], {
      cwd: path.dirname(import.meta.dir),
      env: install.env,
      // Shorter than the test, so a hung prompt fails on the assertions below with the screen it printed.
      timeout: 30_000,
      terminal: {
        // Wide enough that the scratch paths do not wrap.
        cols: 400,
        rows: 50,
        data(terminal, chunk) {
          screen.text += decoder.decode(chunk, { stream: true })
          const text = Bun.stripANSI(screen.text)
          if (text.includes("Cancelled")) finished.resolve()
          if (screen.answered || !text.includes(question)) return
          screen.answered = true
          terminal.write("n")
        },
        exit: () => finished.resolve(),
      },
    })
    const code = await child.exited
    // The last chunk can arrive after the process exit: wait for the answer's outcome, or for the end of the stream.
    await Promise.race([finished.promise, Bun.sleep(10_000)])
    child.terminal?.close()

    const lines = messages(screen.text)
    expect(code, screen.text).toBe(0)
    expect(lines.slice(0, summary(install).length)).toEqual(summary(install))
    expect(lines).toContain(question)
    expect(lines.at(-1)).toBe("Cancelled")
    expect(screen.text.replaceAll(install.root, "")).not.toMatch(/opencode/i)
    await untouched(install, before)
  },
  60_000,
)

test("a forced run stops the kilo2 service and removes the kilo2 cache, and nothing else", async () => {
  await using install = await seed()
  const before = await snapshot(install.home)

  const result = await host(install, "uninstall", "--force")

  expect(result.code, result.output).toBe(0)
  const lines = messages(result.output)
  expect(lines.slice(0, summary(install).length)).toEqual(summary(install))
  // A spinner frame can share the line of its result, so only the end of the line is the message.
  expect(lines.some((line) => line.endsWith("Background services stopped"))).toBe(true)
  expect(lines.some((line) => line.endsWith("Removed Cache"))).toBe(true)
  expect(lines.at(-1)).toBe("Done")
  // No install method: no package manager runs, and no binary or shell PATH step is printed.
  const visible = result.output.replaceAll(install.root, "")
  expect(visible).not.toMatch(/Package|Shell PATH|Binary|Running |Run manually|To finish removing/)
  expect(visible).not.toMatch(/opencode/i)

  // The registered kilo2 service is stopped and its registration is gone. The services that the Kilo v1 and
  // OpenCode state directories register keep running.
  await Promise.race([install.service.exited, Bun.sleep(10_000)])
  expect(install.running()).toEqual({ service: false, decoy: true })

  const after = await snapshot(install.home)
  const removed = (file: string) =>
    file === ".cache/kilo2" || file.startsWith(".cache/kilo2/") || file === ".local/state/kilo2/service-local.json"
  expect(Object.keys(after).filter(removed)).toEqual([])
  // Session data, configuration and state stay, as does every Kilo v1, OpenCode and shell rc file.
  expect(after).toMatchObject(Object.fromEntries(Object.entries(before).filter(([file]) => !removed(file))))
  expect(added(before, after).filter((file) => !boot.artifacts.includes(file))).toEqual([])
}, 60_000)

// A scratch home with a kilo2, a Kilo v1 and an OpenCode installation, each with a registered background service.
// The services are idle processes of this test behind a stub that answers no health request, so stopping one only
// signals a process the test owns.
async function seed() {
  // Owns every resource from the moment it exists, so a failure further down still cleans up.
  await using stack = new AsyncDisposableStack()
  const root = await realpath(
    stack.adopt(await mkdtemp(path.join(os.tmpdir(), "kilo-uninstall-")), (dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  )
  const home = path.join(root, "home")
  // Idle for longer than a test, then gone: a killed test run leaves no process behind for good.
  const idle = () =>
    stack.adopt(
      Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 120_000)"], {
        cwd: root,
        env: { ...process.env, BUN_OPTIONS: "" },
        stdout: "ignore",
        stderr: "ignore",
      }),
      async (child) => {
        child.kill()
        await child.exited
      },
    )
  const service = idle()
  const decoy = idle()
  const requests: string[] = []
  const stub = stack.adopt(
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        requests.push(new URL(request.url).pathname)
        return new Response(null, { status: 404 })
      },
    }),
    (server) => server.stop(true),
  )
  const registered = (pid: number) =>
    JSON.stringify({ id: "test", version: "0.0.0-test", url: `http://127.0.0.1:${stub.port}`, pid, password: "test" })
  // The PATH lines a curl install of OpenCode and of Kilo v1 leave behind.
  const rc = "# opencode\nexport PATH=$HOME/.opencode/bin:$PATH\n# kilo\nexport PATH=$HOME/.kilo/bin:$PATH\n"
  const files = {
    ".config/kilo2/marker.txt": "kilo2 config",
    ".local/share/kilo2/marker.txt": "kilo2 data",
    ".local/state/kilo2/marker.txt": "kilo2 state",
    ".local/state/kilo2/service-local.json": registered(service.pid),
    ".cache/kilo2/marker.txt": "kilo2 cache",
    ".cache/kilo2/bin/marker.txt": "kilo2 cached binary",
    ".config/kilo/kilo.json": "kilo v1 config",
    ".local/share/kilo/kilo.db": "kilo v1 sessions",
    ".local/share/kilo/auth.json": "kilo v1 credentials",
    ".local/state/kilo/service.json": registered(decoy.pid),
    ".cache/kilo/marker.txt": "kilo v1 cache",
    ".kilo/bin/kilo": "kilo v1 binary",
    ".kilocode/marker.txt": "kilo v1 legacy config",
    ".config/opencode/opencode.json": "opencode config",
    ".local/share/opencode/opencode.db": "opencode sessions",
    ".local/share/opencode/auth.json": "opencode credentials",
    ".local/state/opencode/service.json": registered(decoy.pid),
    ".cache/opencode/marker.txt": "opencode cache",
    ".opencode/bin/opencode": "opencode binary",
    ".zshrc": rc,
    ".bashrc": rc,
    ".profile": rc,
    ".config/fish/config.fish":
      "# opencode\nfish_add_path $HOME/.opencode/bin\n# kilo\nfish_add_path $HOME/.kilo/bin\n",
  }
  await Promise.all(Object.entries(files).map(([file, content]) => Bun.write(path.join(home, file), content)))
  await mkdir(path.join(root, "tmp"))
  const owned = stack.move()
  return {
    root,
    home,
    service,
    requests,
    cache: path.join(home, ".cache/kilo2"),
    registration: path.join(home, ".local/state/kilo2/service-local.json"),
    env: environment(root),
    running: () => ({
      service: service.exitCode === null && !service.signalCode,
      decoy: decoy.exitCode === null && !decoy.signalCode,
    }),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  }
}

function environment(root: string) {
  // The test preload isolates XDG for in-process tests; a host boot must not inherit it, or any directory override.
  // ZDOTDIR would point the upstream handler at the real zsh files if an install method were ever detected.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("XDG_") && !/^(OPENCODE|KILO2?)_/.test(key) && key !== "ZDOTDIR" && key !== "FORCE_COLOR",
    ),
  )
  return {
    ...inherited,
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
    KILO_TEST_HOME: path.join(root, "home"),
    // os.tmpdir() reads TMPDIR on POSIX and TEMP or TMP on Windows.
    TMPDIR: path.join(root, "tmp"),
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    SHELL: "/bin/zsh",
    NO_COLOR: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpiled,
    // Flags an outer shell exports (a preload, an export condition) would change how the host loads its modules.
    BUN_OPTIONS: "",
  }
}

// Runs the host entry from the package directory, so its bunfig.toml preload compiles the modules the CLI imports.
async function host(install: Awaited<ReturnType<typeof seed>>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: path.dirname(import.meta.dir),
    env: install.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Shorter than the tests, so a hung child fails on the exit code assertion with the output it printed.
    timeout: 30_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, output: stdout + stderr }
}

// A run that removes nothing: every seeded entry is as it was, the only new entries are those a host boot creates,
// and no service was contacted or stopped.
async function untouched(install: Awaited<ReturnType<typeof seed>>, before: Record<string, string>) {
  const after = await snapshot(install.home)
  expect(after).toMatchObject(before)
  expect(added(before, after).filter((file) => !boot.artifacts.includes(file))).toEqual([])
  expect(install.requests).toEqual([])
  expect(install.running()).toEqual({ service: true, decoy: true })
}

// Each line a user reads, without the gutter symbol that the prompt library draws in front of it.
function messages(output: string) {
  return Bun.stripANSI(output)
    .split("\n")
    .map((line) => line.trim().replace(/^\S+/, "").trim())
    .filter(Boolean)
}

// Every file (with its content) and directory under the home, by path relative to it.
async function snapshot(home: string) {
  const entries = await readdir(home, { recursive: true, withFileTypes: true })
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name)
        const content = entry.isDirectory() ? "<directory>" : await Bun.file(file).text()
        return [path.relative(home, file).replaceAll("\\", "/"), content] as const
      }),
    ),
  )
}

// The entries of `after` that `before` does not have.
function added(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after)
    .filter((file) => !Object.hasOwn(before, file))
    .toSorted()
}

// The upstream prints "Cancelled" and returns normally after a declined confirmation, so the exit code cannot tell it
// apart from a completed uninstall. The cache it removes first is the proof.
test("a declined confirmation does not count as an uninstall", () => {
  expect(uninstalled({}, { before: true, after: true })).toBeFalse()
  expect(uninstalled({}, { before: false, after: false })).toBeFalse()
  expect(uninstalled({}, { before: true, after: false })).toBeTrue()
})

test("--force never asks and a preview changes nothing", () => {
  expect(uninstalled({ force: true }, { before: true, after: true })).toBeTrue()
  expect(uninstalled({ dryRun: true }, { before: true, after: true })).toBeTrue()
})
