import { describe, expect, test } from "bun:test"
import { unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { load, parse } from "../src/nono-credentials"
import { generate, restoreEnvironment } from "../src/nono-profile"
import type { Profile } from "../src/profile"

const paths = { data: "/tmp/kilo-data", config: "/tmp/kilo-config" }

const routes = parse({
  credentials: [
    {
      name: "github",
      source: "env://GITHUB_TOKEN",
      upstream: "https://api.github.com",
      header: "Authorization",
      format: "token {}",
      phantom: "ghp_{}",
    },
  ],
})

function profile(network: Profile["network"] = { mode: "deny", allowedHosts: [] }): Profile {
  return {
    filesystem: {
      allowWrite: [
        { path: "/workspace", kind: "subtree" },
        { path: "/workspace/notes.txt", kind: "literal" },
        { path: "/tmp/kilo-config", kind: "subtree" },
        { path: "/tmp/kilo-state", kind: "subtree" },
      ],
      denyWrite: [{ path: "/tmp/kilo-config", kind: "subtree" }],
      denyNames: [".git"],
      temporaryDirectory: "/tmp/kilo-tmp",
    },
    network,
    environment: { deny: ["KILO_CONFIG"], set: { TMPDIR: "/tmp/kilo-tmp" } },
  }
}

// The backend is macOS-only, and these fixtures use POSIX paths that do not map to Windows separators.
describe.skipIf(process.platform === "win32")("nono profile generation", () => {
  test("denies network without leaving an allowlist behind", () => {
    const result = generate(profile(), { paths })
    expect(result.network).toEqual({ block: true })
  })

  test("allows a fully open network only in allow mode", () => {
    expect(generate(profile({ mode: "allow", allowedHosts: [] }), { paths }).network).toEqual({ block: false })
  })

  test("maps the allowlist to domains without ports", () => {
    const result = generate(profile({ mode: "proxy", allowedHosts: ["api.github.com:443", "example.com:8443"] }), {
      paths,
    })
    expect(result.network).toEqual({
      allow_domain: ["api.github.com", "example.com"],
    })
  })

  test("blocks egress when proxy mode carries no hosts", () => {
    const result = generate(profile({ mode: "proxy", allowedHosts: [] }), { paths })
    expect(result.network).toEqual({ block: true })
  })

  test("adds credential routes with references, never values", () => {
    const result = generate(profile({ mode: "proxy", allowedHosts: ["api.github.com:443"] }), {
      paths,
      credentials: routes,
    })
    expect(result.network).toEqual({
      allow_domain: ["api.github.com"],
      credentials: ["github"],
      custom_credentials: {
        github: {
          upstream: "https://api.github.com",
          credential_key: "env://GITHUB_TOKEN",
          env_var: "GITHUB_TOKEN",
          inject_header: "Authorization",
          credential_format: "token {}",
          phantom_format: "ghp_{}",
        },
      },
    })
  })

  test("ignores credential routes outside proxy mode", () => {
    const result = generate(profile(), { paths, credentials: routes })
    expect(result.network).toEqual({ block: true })
  })

  test("separates subtree and literal write grants", () => {
    const result = generate(profile(), { paths })
    expect(result.filesystem.allow).toEqual(["/workspace", "/tmp/kilo-state"])
    expect(result.filesystem.allow_file).toEqual(
      expect.arrayContaining(["/workspace/notes.txt", "/dev/null", "/dev/urandom"]),
    )
  })

  test("denies every denyWrite rule, including ones inside a grant", () => {
    const result = generate(profile(), { paths })
    expect(result.filesystem.allow).not.toContain("/tmp/kilo-config")
    expect(result.filesystem.deny).toContain("/tmp/kilo-config")
    const nested = generate(
      {
        ...profile(),
        filesystem: { ...profile().filesystem, denyWrite: [{ path: "/workspace/.git", kind: "subtree" }] },
      },
      { paths },
    )
    expect(nested.filesystem.deny).toContain("/workspace/.git")
  })

  test("confines reads to the write set plus Kilo's temp directory", () => {
    const result = generate(profile(), { paths })
    expect(result.filesystem.read).toEqual(["/workspace", "/tmp/kilo-state", "/tmp/kilo-tmp"])
    expect(result.filesystem.read_file).toEqual(["/workspace/notes.txt"])
  })

  test("honours an explicit read set", () => {
    const result = generate(profile(), { paths, reads: [{ path: "/workspace/src", kind: "subtree" }] })
    expect(result.filesystem.read).toContain("/workspace/src")
    expect(result.filesystem.read).not.toContain("/workspace")
  })

  test("denies credential locations and Kilo's own stores", () => {
    const result = generate(profile(), { paths })
    expect(result.filesystem.deny).toContain("$HOME/.ssh")
    expect(result.filesystem.deny).toContain("$HOME/.aws")
    expect(result.filesystem.deny).toEqual(
      expect.arrayContaining([
        "/tmp/kilo-data/kilo2.db",
        "/tmp/kilo-data/kilo2.db-wal",
        "/tmp/kilo-data/kilo2.db-shm",
        "/tmp/kilo-data/kilo2*.db*",
        "/tmp/kilo-data/auth.json",
        "/tmp/kilo-data/opencode.db",
        "/tmp/kilo-data/opencode.db-wal",
        "/tmp/kilo-data/opencode.db-shm",
        "/tmp/kilo-data/opencode*.db*",
      ]),
    )
  })

  test("denies the database named by the host, not only the release file", () => {
    const result = generate(profile(), { paths, denies: ["/custom/session.db", "/custom/session.db-wal"] })
    expect(result.filesystem.deny).toEqual(expect.arrayContaining(["/custom/session.db", "/custom/session.db-wal"]))
  })

  test("hides nono's own XDG roots from the child", () => {
    const result = generate(profile(), { paths })
    expect(result.environment?.deny_vars).toEqual(
      expect.arrayContaining(["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"]),
    )
  })

  test("leaves proxy variables to the backend that owns the launch environment", () => {
    const result = generate(profile(), { paths })
    expect(result.environment?.deny_vars).not.toContain("HTTP_PROXY")
    expect(result.environment?.deny_vars).not.toContain("HTTPS_PROXY")
  })

  test("restores loader variables and secret aliases", () => {
    const result = generate(profile(), {
      paths,
      restore: { NODE_OPTIONS: "--max-old-space-size=4096" },
      secret: ["GH_TOKEN"],
    })
    expect(result.environment?.deny_vars).toContain("GH_TOKEN")
    expect(result.environment?.set_vars).toEqual({
      NODE_OPTIONS: "--max-old-space-size=4096",
      TMPDIR: "/tmp/kilo-tmp",
    })
  })

  test("keeps restored XDG roots and drops masked names", () => {
    const kept = generate(profile(), { paths, restore: { XDG_CONFIG_HOME: "/u/.config" } })
    expect(kept.environment?.set_vars.XDG_CONFIG_HOME).toBe("/u/.config")
    const dropped = generate(profile(), {
      paths,
      restore: { NODE_OPTIONS: "--max-old-space-size=4096" },
      secret: ["NODE_OPTIONS"],
    })
    expect(dropped.environment?.set_vars.NODE_OPTIONS).toBeUndefined()
  })

  test("excludes the default write groups and keeps any extra exclusions", () => {
    expect(generate(profile(), { paths }).groups).toEqual({
      exclude: ["system_write_macos", "system_write_linux"],
    })
    expect(generate(profile(), { paths, exclude: ["temporary_files"] }).groups).toEqual({
      exclude: ["system_write_macos", "system_write_linux", "temporary_files"],
    })
  })

  test("grants the launch cwd only when the profile covers it", () => {
    expect(generate(profile(), { paths, cwd: "/workspace/src" }).workdir).toEqual({ access: "readwrite" })
    expect(generate(profile(), { paths, cwd: "/elsewhere" }).workdir).toEqual({ access: "none" })
    expect(
      generate(profile(), { paths, cwd: "/elsewhere", reads: [{ path: "/elsewhere", kind: "subtree" }] }).workdir,
    ).toEqual({ access: "read" })
  })

  test("always emits a network decision", () => {
    for (const network of [
      { mode: "allow", allowedHosts: [] },
      { mode: "deny", allowedHosts: [] },
      { mode: "proxy", allowedHosts: [] },
      { mode: "proxy", allowedHosts: ["example.com:443"] },
    ] satisfies Array<Profile["network"]>) {
      const result = generate(profile(network), { paths })
      expect(result.network.block !== undefined || result.network.allow_domain !== undefined).toBe(true)
    }
  })

  test("resolves relative state roots before denying them", () => {
    const result = generate(profile(), { paths: { data: "rel-data", config: "rel-config" } })
    expect(result.filesystem.deny).toContain(path.resolve("rel-data/kilo2.db"))
    expect(result.filesystem.deny).toContain(path.resolve("rel-config"))
  })

  test("denies the config and data roots named by the environment", () => {
    const previous = {
      config: process.env.OPENCODE_CONFIG_DIR,
      data: process.env.XDG_DATA_HOME,
      app: process.env.OPENCODE_APP_DIR_NAME,
    }
    process.env.OPENCODE_CONFIG_DIR = "/custom/config"
    process.env.XDG_DATA_HOME = "/custom/share"
    process.env.OPENCODE_APP_DIR_NAME = "kilo2"
    try {
      const result = generate(profile())
      expect(result.filesystem.deny).toContain("/custom/config")
      expect(result.filesystem.deny).toEqual(
        expect.arrayContaining(["/custom/share/kilo2/kilo2.db", "/custom/share/kilo2/auth.json"]),
      )
    } finally {
      if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previous.config
      if (previous.data === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = previous.data
      if (previous.app === undefined) delete process.env.OPENCODE_APP_DIR_NAME
      else process.env.OPENCODE_APP_DIR_NAME = previous.app
    }
  })

  test("rejects two credentials that read the same variable", () => {
    expect(() =>
      parse({
        credentials: [
          { name: "one", source: "env://SHARED", upstream: "https://example.com" },
          { name: "two", source: "env://SHARED", upstream: "https://example.com" },
        ],
      }),
    ).toThrow()
  })

  test("denies known aliases of a routed credential", () => {
    const result = generate(profile({ mode: "proxy", allowedHosts: ["api.github.com:443"] }), {
      paths,
      credentials: routes,
    })
    expect(result.environment?.deny_vars).toEqual(expect.arrayContaining(["GH_TOKEN", "GITHUB_OAUTH_TOKEN"]))
    expect(result.environment?.deny_vars).not.toContain("GITHUB_TOKEN")
  })

  test("denies the canonical name when a route uses an alias", () => {
    const aliased = parse({
      credentials: [{ name: "github", source: "env://GH_TOKEN", upstream: "https://example.com" }],
    })
    const result = generate(profile({ mode: "proxy", allowedHosts: ["api.github.com:443"] }), {
      paths,
      credentials: aliased,
    })
    expect(result.environment?.deny_vars).toEqual(expect.arrayContaining(["GITHUB_TOKEN", "GITHUB_OAUTH_TOKEN"]))
    expect(result.environment?.deny_vars).not.toContain("GH_TOKEN")
  })
})

// Reading a credential file is platform independent, so these stay outside the POSIX-only suite above.
describe("nono credential file", () => {
  test("treats an absent file as no routes", () => {
    expect(load(path.join(os.tmpdir(), `kilo-absent-${process.pid}-${Date.now()}.json`))).toEqual([])
  })

  test("rejects malformed JSON", () => {
    const file = path.join(os.tmpdir(), `kilo-invalid-${process.pid}-${Date.now()}.json`)
    writeFileSync(file, "{")
    try {
      expect(() => load(file)).toThrow()
    } finally {
      unlinkSync(file)
    }
  })

  test("rejects a phantom longer than nono accepts", () => {
    const credential = (shaped: string) => ({
      credentials: [{ name: "one", source: "env://ONE", upstream: "https://example.com", phantom: shaped }],
    })
    expect(() => parse(credential(`${"a".repeat(65)}{}`))).toThrow()
    expect(parse(credential(`${"a".repeat(64)}{}`))).toHaveLength(1)
  })
})

// Restoring the child's loader and XDG variables is platform independent, so it runs everywhere.
describe("restoreEnvironment", () => {
  test("returns only the loader and XDG variables that are set", () => {
    expect(restoreEnvironment({ NODE_OPTIONS: "-r ./hook.js", XDG_CACHE_HOME: "/cache", OTHER: "kept-out" })).toEqual({
      NODE_OPTIONS: "-r ./hook.js",
      XDG_CACHE_HOME: "/cache",
    })
  })

  test("returns nothing when the launch carries none of them", () => {
    expect(restoreEnvironment({ PATH: "/usr/bin:/bin" })).toEqual({})
  })
})
