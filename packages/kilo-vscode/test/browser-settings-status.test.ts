import { describe, expect, test } from "bun:test"
import {
  extensionConnected,
  hubsDirectory,
  installedChromium,
  status,
  systemBrowser,
} from "../src/browser-settings/status"

const noFiles = { exists: () => false, entries: () => [], text: () => "", alive: () => false }

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

  test("the installed chromium counts when no system browser exists", () => {
    expect(installedChromium("/data", { ...noFiles, entries: () => ["chromium-1200"] })).toBe(true)
    expect(installedChromium("/data", { ...noFiles, entries: () => ["firefox-1500"] })).toBe(false)
  })

  test("a missing browsers directory is no chromium", () => {
    expect(installedChromium("/data", noFiles)).toBe(false)
  })

  test("status reports ready with the target it found", () => {
    expect(
      status({
        data: "/data",
        platform: "linux",
        home: "/home/igor",
        env: {},
        reader: { ...noFiles, entries: () => ["chromium-1200"] },
      }).playwright,
    ).toEqual({ ready: true, target: "chromium" })
  })

  test("status reports not ready without any browser", () => {
    expect(
      status({ data: "/data", platform: "linux", home: "/home/igor", env: {}, reader: noFiles }).playwright,
    ).toEqual({ ready: false })
  })
})

describe("extension connection", () => {
  const hubs = {
    platform: "linux" as const,
    home: "/home/igor",
    env: { XDG_RUNTIME_DIR: "/run/user/1000" },
  }

  test("the hub registry lives in the runtime directory on linux", () => {
    expect(hubsDirectory(hubs.platform, hubs.home, hubs.env)).toBe("/run/user/1000/kilo-browser/hubs")
  })

  test("the hub registry lives in application support on macOS", () => {
    expect(hubsDirectory("darwin", "/Users/igor", {})).toBe(
      "/Users/igor/Library/Application Support/kilo/browser/run/hubs",
    )
  })

  test("a registered hub with a live process is a connected extension", () => {
    expect(
      extensionConnected({
        ...hubs,
        data: "/data",
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
        ...hubs,
        data: "/data",
        reader: { ...noFiles, entries: () => ["hub.json"], text: () => JSON.stringify({ pid: 4242 }) },
      }),
    ).toBe(false)
  })

  test("without a hub registry directory nothing is connected", () => {
    expect(extensionConnected({ ...hubs, data: "/data", reader: noFiles })).toBe(false)
    expect(extensionConnected({ ...hubs, env: {}, data: "/data", reader: noFiles })).toBe(false)
  })
})
