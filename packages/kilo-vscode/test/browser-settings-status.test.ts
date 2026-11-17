import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  extensionConnected,
  hubsDirectory,
  installedChromium,
  status,
  systemBrowser,
} from "../src/browser-settings/status"

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

describe("extension connection", () => {
  // The CLI's `Paths.run()` is `<state dir>/browser/run`, and its registry lists `<run dir>/hubs/*.json`.
  const hubs = path.join(state, "browser", "run", "hubs")

  test("the hub registry lives in the state directory, as the CLI writes it", () => {
    expect(hubsDirectory(state, {})).toBe(hubs)
  })

  test("KILO_BROWSER_RUN_DIR moves the registry, as it moves the CLI's", () => {
    expect(hubsDirectory(state, { KILO_BROWSER_RUN_DIR: "/tmp/run" })).toBe("/tmp/run/hubs")
  })

  test("a registered hub with a live process is a connected extension", () => {
    expect(
      extensionConnected({
        data,
        state,
        reader: {
          ...noFiles,
          entries: () => ["hub.json"],
          text: () => JSON.stringify({ pid: 4242 }),
          alive: (pid) => pid === 4242,
        },
      }),
    ).toBe(true)
  })

  test("a hub whose process exited is not connected", () => {
    expect(
      extensionConnected({
        data,
        state,
        reader: { ...noFiles, entries: () => ["hub.json"], text: () => JSON.stringify({ pid: 4242 }) },
      }),
    ).toBe(false)
  })

  test("without a hub registry directory nothing is connected", () => {
    expect(extensionConnected({ data, state, reader: noFiles })).toBe(false)
  })
})
