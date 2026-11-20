import { describe, expect, test } from "bun:test"
import path from "node:path"
import { extensionStatus, hubsDirectory, installedChromium, status, systemBrowser } from "../src/browser-settings/status"

const noFiles = { exists: () => false, entries: () => [], text: () => "", alive: () => false }

const data = "/data/kilo2"
const state = "/state/kilo2"

/** A reader for a data directory whose Chromium builds have exactly these paths. */
function machine(files: string[], entries: string[] = ["chromium-1200"]) {
  return {
    ...noFiles,
    exists: (file: string) => files.includes(file),
    entries: (directory: string) => (directory === path.join(data, "browser", "browsers") ? entries : []),
  }
}

const build = path.join(data, "browser", "browsers", "chromium-1200")
const marker = path.join(build, "INSTALLATION_COMPLETE")
const executableFor = (platform: "linux" | "darwin" | "win32") =>
  path.join(
    build,
    platform === "darwin"
      ? "chrome-mac/Chromium.app/Contents/MacOS/Chromium"
      : platform === "win32"
        ? "chrome-win/chrome.exe"
        : "chrome-linux/chrome",
  )

describe("playwright target", () => {
  test("chrome wins over edge", () => {
    const found = systemBrowser({
      platform: "darwin",
      home: "/Users/igor",
      env: {},
      reader: { exists: (file) => file.endsWith("Google Chrome") || file.endsWith("Microsoft Edge") },
    })
    expect(found).toBe("chrome")
  })

  test("edge is used when chrome is absent", () => {
    const found = systemBrowser({
      platform: "darwin",
      home: "/Users/igor",
      env: {},
      reader: { exists: (file) => file.endsWith("Microsoft Edge") },
    })
    expect(found).toBe("msedge")
  })

  test("a complete chromium build counts when no system browser exists", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(installedChromium(data, platform, machine([marker, executableFor(platform)]))).toBe(true)
    }
  })

  test("a directory without the executable is not an install", () => {
    // The archive can be extracted and the executable missing; the plugin's locate.ts would find nothing to start.
    expect(installedChromium(data, "linux", machine([marker]))).toBe(false)
    // And the completion marker is what playwright's own installer checks before it downloads again.
    expect(installedChromium(data, "linux", machine([executableFor("linux")]))).toBe(false)
  })

  test("another browser's revision and a plain chromium directory do not count", () => {
    expect(installedChromium(data, "linux", machine([marker, executableFor("linux")], ["firefox-1500"]))).toBe(false)
    expect(installedChromium(data, "linux", machine([marker, executableFor("linux")], ["chromium"]))).toBe(false)
  })

  test("a missing browsers directory is no chromium", () => {
    expect(installedChromium(data, "linux", noFiles)).toBe(false)
  })

  test("status reports ready with the target it found", () => {
    expect(
      status({
        data,
        state,
        platform: "linux",
        home: "/home/igor",
        env: {},
        reader: machine([marker, executableFor("linux")]),
      }).playwright,
    ).toEqual({ ready: true, target: "chromium" })
  })

  test("status reports not ready without any browser", () => {
    expect(status({ data, state, platform: "linux", home: "/home/igor", env: {}, reader: noFiles }).playwright).toEqual(
      { ready: false },
    )
  })
})

describe("extension status", () => {
  // The CLI's `Paths.run()` is `<state dir>/browser/run`, and its registry lists `<run dir>/hubs/*.json`.
  const hubs = path.join(state, "browser", "run", "hubs")

  test("the hub registry lives in the state directory, as the CLI writes it", () => {
    expect(hubsDirectory(state, {})).toBe(hubs)
  })

  test("KILO_BROWSER_RUN_DIR moves the registry, as it moves the CLI's", () => {
    // `hubsDirectory` joins with the platform separator, as the CLI's `Paths.hubs()` does; asserting a spelled
    // "/tmp/run/hubs" would only hold on posix.
    expect(hubsDirectory(state, { KILO_BROWSER_RUN_DIR: path.join(path.sep, "tmp", "run") })).toBe(
      path.join(path.sep, "tmp", "run", "hubs"),
    )
  })

  /** A registry with these hub entries, keyed by file name; `live` lists the pids whose process still runs. */
  const registry = (files: Record<string, unknown>, live: number[]) => ({
    ...noFiles,
    entries: () => Object.keys(files),
    text: (file: string) => JSON.stringify(files[path.basename(file)]),
    alive: (pid: number) => live.includes(pid),
  })

  test("a live hub with no extension connected is waiting, not connected", () => {
    // An unpaired hub, or one whose extension turned "Allow local agents" off: the hub clears `browser` on disconnect.
    const reader = registry({ "hub.json": { pid: 4242, browser: null, profileLabel: null } }, [4242])
    expect(extensionStatus({ data, state, reader })).toEqual({ state: "waiting" })
  })

  test("a live hub with a connected extension names its browser and profile", () => {
    const reader = registry(
      { "hub.json": { pid: 4242, browser: { name: "Chrome", version: "142.0" }, profileLabel: "Work" } },
      [4242],
    )
    expect(extensionStatus({ data, state, reader })).toEqual({ state: "connected", browser: "Chrome", profile: "Work" })
  })

  test("the connected hub wins over a waiting one, and an empty profile is left out", () => {
    const reader = registry(
      {
        "a.json": { pid: 1, browser: null, profileLabel: null },
        "b.json": { pid: 2, browser: { name: "Edge", version: "141" }, profileLabel: "" },
      },
      [1, 2],
    )
    expect(extensionStatus({ data, state, reader })).toEqual({ state: "connected", browser: "Edge" })
  })

  test("a hub whose process exited counts as no hub, even with a browser recorded", () => {
    const reader = registry({ "hub.json": { pid: 4242, browser: { name: "Chrome", version: "1" } } }, [])
    expect(extensionStatus({ data, state, reader })).toEqual({ state: "none" })
  })

  test("without a hub registry directory, or with only unreadable entries, there is no hub", () => {
    expect(extensionStatus({ data, state, reader: noFiles })).toEqual({ state: "none" })
    const broken = { ...noFiles, entries: () => ["hub.json", "notes.txt"], text: () => "{", alive: () => true }
    expect(extensionStatus({ data, state, reader: broken })).toEqual({ state: "none" })
  })

  test("status carries the extension state", () => {
    const reader = registry({ "hub.json": { pid: 7, browser: null } }, [7])
    expect(status({ data, state, platform: "linux", reader }).extension).toEqual({ state: "waiting" })
  })
})
