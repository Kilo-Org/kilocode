import { describe, expect, test } from "bun:test"
import { check, report, versions, vulnerable, type Alert } from "./stale-alerts"

const bun = `{
  "packages": {
    "simple-git": ["simple-git@4.0.2", "", {}, "sha"],
    "marked-katex-extension": ["marked-katex-extension@5.1.6", "", {}, "sha"],
    "katex": ["katex@0.16.27", "", {}, "sha"],
    "mermaid/katex": ["katex@0.16.47", "", {}, "sha"],
    "@scope/pkg": ["@scope/pkg@1.0.0-beta.1", "", {}, "sha"],
  }
}`

const pnpm = `packages:
  next@16.3.6:
    resolution: {integrity: sha}
snapshots:
  '@markdoc/next.js@0.5.0(next@16.3.6(react@19.2.8))(react@19.2.8)': {}
`

const alert = (name: string, range: string, manifest: string, ecosystem = "npm"): Alert => ({
  number: 7,
  html_url: "https://github.com/o/r/security/dependabot/7",
  dependency: { package: { name, ecosystem }, manifest_path: manifest },
  security_vulnerability: { vulnerable_version_range: range },
})

const files: Record<string, string> = {
  "bun.lock": bun,
  "package.json": "{}",
  "packages/kilo-docs/package.json": "{}",
  "packages/kilo-docs/pnpm-lock.yaml": pnpm,
}
const read = (path: string) => files[path]

describe("stale-alerts versions", () => {
  test("reads every resolved version of one package", () => {
    expect(versions(bun, "katex")).toEqual(["0.16.27", "0.16.47"])
  })

  test("does not match a package that only ends with the name", () => {
    expect(versions(bun, "extension")).toEqual([])
    expect(versions(bun, "marked-katex-extension")).toEqual(["5.1.6"])
  })

  test("reads scoped packages and prereleases", () => {
    expect(versions(bun, "@scope/pkg")).toEqual(["1.0.0-beta.1"])
  })

  test("reads pnpm entries and snapshot references", () => {
    expect(versions(pnpm, "next")).toEqual(["16.3.6"])
  })
})

describe("stale-alerts vulnerable", () => {
  test("handles the comma form GitHub uses", () => {
    expect(vulnerable("3.36.0", ">= 3.15.0, < 4.0.1")).toBe(true)
    expect(vulnerable("4.0.2", ">= 3.15.0, < 4.0.1")).toBe(false)
    expect(vulnerable("8.0.4", "< 4.0.4")).toBe(false)
  })
})

describe("stale-alerts check", () => {
  test("reports a lockfile that moved past the vulnerable range", () => {
    const reason = check(alert("simple-git", ">= 3.15.0, < 4.0.1", "package.json"), read)
    expect(reason).toContain("4.0.2")
  })

  test("keeps an alert while any resolved version is vulnerable", () => {
    expect(check(alert("katex", "< 0.16.30", "package.json"), read)).toBeUndefined()
  })

  test("reports a manifest that no longer exists", () => {
    expect(check(alert("next", "< 15.6.0", "apps/web-roo-code/package.json"), read)).toBe("manifest no longer exists")
  })

  test("reports a package that left the lockfile", () => {
    expect(check(alert("lodash", "< 4.17.21", "package.json"), read)).toBe("package is no longer in the lockfile")
  })

  test("uses the workspace lockfile for a workspace manifest", () => {
    const reason = check(
      alert("next", ">= 15.0.0-canary.0, < 15.6.0-canary.61", "packages/kilo-docs/package.json"),
      read,
    )
    expect(reason).toContain("16.3.6")
  })

  test("accepts a lockfile as the manifest", () => {
    expect(check(alert("next", "< 16.0.0", "packages/kilo-docs/pnpm-lock.yaml"), read)).toContain("16.3.6")
    expect(check(alert("next", "< 17.0.0", "packages/kilo-docs/pnpm-lock.yaml"), read)).toBeUndefined()
  })

  test("skips other ecosystems and manifests without a known lockfile", () => {
    expect(check(alert("okhttp", "< 5", "packages/kilo-jetbrains/build.gradle.kts", "maven"), read)).toBeUndefined()
    const only = (path: string) => (path === "other/package.json" ? "{}" : undefined)
    expect(check(alert("lodash", "< 5", "other/package.json"), only)).toBeUndefined()
  })
})

describe("stale-alerts report", () => {
  test("is empty when every alert still applies", () => {
    const out = report([alert("katex", "< 0.16.30", "package.json")], read)
    expect(out.count).toBe(0)
    expect(out.text).toBe("")
  })

  test("lists stale alerts and adds the run link", () => {
    const list = [
      alert("simple-git", ">= 3.15.0, < 4.0.1", "package.json"),
      alert("katex", "< 0.16.30", "package.json"),
    ]
    const out = report(list, read, "https://example.com/run")
    expect(out.count).toBe(1)
    expect(out.text).toContain("*Open Dependabot alerts that look stale: 1*")
    expect(out.text).toContain("`simple-git`")
    expect(out.text).toContain("<https://example.com/run|Workflow run>")
    expect(out.text).not.toContain("katex")
  })

  test("caps the message but keeps the full list", () => {
    const list = Array.from({ length: 25 }, () => alert("simple-git", ">= 3.15.0, < 4.0.1", "package.json"))
    const out = report(list, read)
    expect(out.count).toBe(25)
    expect(out.text).toContain("and 5 more")
    expect(out.full.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(25)
  })
})
