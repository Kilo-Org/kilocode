import { test, expect, describe } from "bun:test"
import { IgnoreMigrator } from "../../src/kilocode/ignore-migrator"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("IgnoreMigrator", () => {
  describe("parseIgnoreContent", () => {
    test("parses basic patterns", () => {
      const content = `
# Comment
secrets/
*.env
!.env.example
`
      const patterns = IgnoreMigrator.parseIgnoreContent(content)

      expect(patterns).toEqual([
        { pattern: "secrets/", negated: false },
        { pattern: "*.env", negated: false },
        { pattern: ".env.example", negated: true },
      ])
    })

    test("ignores empty lines and comments", () => {
      const content = `
# This is a comment
pattern1

# Another comment
pattern2
`
      const patterns = IgnoreMigrator.parseIgnoreContent(content)

      expect(patterns).toHaveLength(2)
      expect(patterns[0].pattern).toBe("pattern1")
      expect(patterns[1].pattern).toBe("pattern2")
    })

    test("handles negation patterns", () => {
      const content = `*.log
!important.log`
      const patterns = IgnoreMigrator.parseIgnoreContent(content)

      expect(patterns[0]).toEqual({ pattern: "*.log", negated: false })
      expect(patterns[1]).toEqual({ pattern: "important.log", negated: true })
    })

    test("handles empty content", () => {
      const patterns = IgnoreMigrator.parseIgnoreContent("")
      expect(patterns).toHaveLength(0)
    })

    test("handles content with only comments", () => {
      const content = `# Comment 1
# Comment 2`
      const patterns = IgnoreMigrator.parseIgnoreContent(content)
      expect(patterns).toHaveLength(0)
    })

    test("trims whitespace from patterns", () => {
      const content = `  secrets/  
  *.env  `
      const patterns = IgnoreMigrator.parseIgnoreContent(content)

      expect(patterns[0].pattern).toBe("secrets/")
      expect(patterns[1].pattern).toBe("*.env")
    })
  })

  describe("convertToGlob", () => {
    test("converts directory pattern", () => {
      expect(IgnoreMigrator.convertToGlob("secrets/")).toBe("secrets/*")
    })

    test("preserves simple filename pattern", () => {
      // Opencode's * already matches any path depth
      expect(IgnoreMigrator.convertToGlob("*.env")).toBe("*.env")
    })

    test("converts rooted patterns", () => {
      expect(IgnoreMigrator.convertToGlob("/root-only")).toBe("root-only")
    })

    test("preserves patterns with path separators", () => {
      expect(IgnoreMigrator.convertToGlob("src/secrets/")).toBe("src/secrets/*")
    })

    test("handles double-star patterns", () => {
      expect(IgnoreMigrator.convertToGlob("**/deep/")).toBe("*deep/*")
    })

    test("preserves simple filename without extension", () => {
      // Opencode's * already matches any path depth
      expect(IgnoreMigrator.convertToGlob("Dockerfile")).toBe("Dockerfile")
    })

    test("preserves extension-only pattern", () => {
      expect(IgnoreMigrator.convertToGlob("*.log")).toBe("*.log")
    })

    test("preserves nested path pattern", () => {
      expect(IgnoreMigrator.convertToGlob("config/secrets.json")).toBe("config/secrets.json")
    })
  })

  describe("buildPermissionRules", () => {
    test("creates default allow rule", () => {
      const rules = IgnoreMigrator.buildPermissionRules([])
      expect(rules["*"]).toBe("allow")
    })

    test("creates deny rules for patterns", () => {
      const patterns = [{ pattern: "secrets/", negated: false, source: "project" as const }]
      const rules = IgnoreMigrator.buildPermissionRules(patterns)

      expect(rules["*"]).toBe("allow")
      expect(rules["secrets/*"]).toBe("deny")
    })

    test("creates allow rules for negated patterns", () => {
      const patterns = [
        { pattern: "*.env", negated: false, source: "project" as const },
        { pattern: ".env.example", negated: true, source: "project" as const },
      ]
      const rules = IgnoreMigrator.buildPermissionRules(patterns)

      expect(rules["*.env"]).toBe("deny")
      expect(rules[".env.example"]).toBe("allow")
    })

    test("handles multiple deny patterns", () => {
      const patterns = [
        { pattern: "secrets/", negated: false, source: "project" as const },
        { pattern: "*.env", negated: false, source: "project" as const },
        { pattern: "*.key", negated: false, source: "project" as const },
      ]
      const rules = IgnoreMigrator.buildPermissionRules(patterns)

      expect(rules["secrets/*"]).toBe("deny")
      expect(rules["*.env"]).toBe("deny")
      expect(rules["*.key"]).toBe("deny")
    })

    test("negated patterns override deny patterns", () => {
      const patterns = [
        { pattern: "config/", negated: false, source: "project" as const },
        { pattern: "config/public.json", negated: true, source: "project" as const },
      ]
      const rules = IgnoreMigrator.buildPermissionRules(patterns)

      expect(rules["config/*"]).toBe("deny")
      expect(rules["config/public.json"]).toBe("allow")
    })
  })

  describe("migrate", () => {
    test("returns empty permission for project without .kilocodeignore", async () => {
      await using tmp = await tmpdir()

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.patternCount).toBe(0)
      expect(Object.keys(result.permission)).toHaveLength(0)
    })

    test("loads project .kilocodeignore", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/\n*.env")
        },
      })

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.patternCount).toBe(2)
      expect(result.permission.read).toBeDefined()
      expect(result.permission.edit).toBeDefined()
    })

    test("applies patterns to both read and edit", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/")
        },
      })

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      const readRules = result.permission.read as Record<string, string>
      const editRules = result.permission.edit as Record<string, string>

      expect(readRules["secrets/*"]).toBe("deny")
      expect(editRules["secrets/*"]).toBe("deny")
    })

    test("handles negation patterns correctly", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "*.env\n!.env.example")
        },
      })

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      const readRules = result.permission.read as Record<string, string>

      expect(readRules["*.env"]).toBe("deny")
      expect(readRules[".env.example"]).toBe("allow")
    })

    test("handles complex .kilocodeignore file", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, ".kilocodeignore"),
            `# Secrets
secrets/
*.env
!.env.example

# Keys
*.key
*.pem

# Config
/config/private/
!config/private/public.json
`,
          )
        },
      })

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.patternCount).toBe(7)

      const readRules = result.permission.read as Record<string, string>
      expect(readRules["*"]).toBe("allow")
      expect(readRules["secrets/*"]).toBe("deny")
      expect(readRules["*.env"]).toBe("deny")
      expect(readRules[".env.example"]).toBe("allow")
      expect(readRules["*.key"]).toBe("deny")
      expect(readRules["*.pem"]).toBe("deny")
      expect(readRules["config/private/*"]).toBe("deny")
      expect(readRules["config/private/public.json"]).toBe("allow")
    })

    test("returns empty warnings array", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/")
        },
      })

      const result = await IgnoreMigrator.migrate({
        projectDir: tmp.path,
        skipGlobalPaths: true,
      })

      expect(result.warnings).toHaveLength(0)
    })
  })

  describe("loadIgnoreConfig", () => {
    test("returns empty object for project without .kilocodeignore", async () => {
      await using tmp = await tmpdir()

      const permission = await IgnoreMigrator.loadIgnoreConfig(tmp.path, true)

      expect(Object.keys(permission)).toHaveLength(0)
    })

    test("returns permission config for project with .kilocodeignore", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilocodeignore"), "secrets/")
        },
      })

      const permission = await IgnoreMigrator.loadIgnoreConfig(tmp.path, true)

      expect(permission.read).toBeDefined()
      expect(permission.edit).toBeDefined()
    })

    test("handles errors gracefully", async () => {
      // Pass a non-existent directory
      const permission = await IgnoreMigrator.loadIgnoreConfig("/non/existent/path", true)

      expect(Object.keys(permission)).toHaveLength(0)
    })
  })
})
