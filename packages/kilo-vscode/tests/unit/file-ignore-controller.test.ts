import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { FileIgnoreController } from "../../src/services/autocomplete/shims/FileIgnoreController"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-ignore-"))
  tempDirs.push(dir)
  return dir
}

describe("FileIgnoreController", () => {
  describe("when .kilocodeignore exists", () => {
    it("applies only .kilocodeignore patterns", async () => {
      const workspace = await createTempWorkspace()
      await fs.writeFile(path.join(workspace, ".kilocodeignore"), "secret/**\n*.snap\n")

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      expect(controller.validateAccess("secret/keys.txt")).toBe(false)
      expect(controller.validateAccess(path.join(workspace, "a.snap"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, "src", "main.ts"))).toBe(true)
      expect(controller.getInstructions()).toContain(".kilocodeignore")
    })

    it("does NOT block .env files unless explicitly listed", async () => {
      const workspace = await createTempWorkspace()
      await fs.writeFile(path.join(workspace, ".kilocodeignore"), "dist/\n")

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      expect(controller.validateAccess(path.join(workspace, ".env"))).toBe(true)
      expect(controller.validateAccess(path.join(workspace, ".env.local"))).toBe(true)
      expect(controller.validateAccess(path.join(workspace, ".env.production"))).toBe(true)
    })

    it("does NOT apply .gitignore patterns", async () => {
      const workspace = await createTempWorkspace()
      await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules/\n")
      await fs.writeFile(path.join(workspace, ".kilocodeignore"), "dist/\n")

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      // .gitignore pattern should NOT apply
      expect(controller.validateAccess(path.join(workspace, "node_modules", "foo.js"))).toBe(true)
      // .kilocodeignore pattern should apply
      expect(controller.validateAccess(path.join(workspace, "dist", "bundle.js"))).toBe(false)
    })
  })

  describe("when no .kilocodeignore exists (fallback)", () => {
    it("applies .gitignore patterns", async () => {
      const workspace = await createTempWorkspace()
      await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules/\nbuild/\n")

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      expect(controller.validateAccess(path.join(workspace, "node_modules", "foo.js"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, "build", "output.js"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, "src", "main.ts"))).toBe(true)
      expect(controller.getInstructions()).toContain(".gitignore")
    })

    it("blocks .env files via hardcoded sensitive patterns", async () => {
      const workspace = await createTempWorkspace()
      // No .kilocodeignore, no .gitignore

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      expect(controller.validateAccess(path.join(workspace, ".env"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, ".env.local"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, ".env.production"))).toBe(false)
      // Regular files should still be allowed
      expect(controller.validateAccess(path.join(workspace, "src", "main.ts"))).toBe(true)
    })

    it("blocks .env files even when .gitignore exists", async () => {
      const workspace = await createTempWorkspace()
      await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules/\n")

      const controller = new FileIgnoreController(workspace)
      await controller.initialize()

      expect(controller.validateAccess(path.join(workspace, ".env"))).toBe(false)
      expect(controller.validateAccess(path.join(workspace, ".env.local"))).toBe(false)
    })
  })

  describe("when constructed with empty workspace path", () => {
    it("denies all access", async () => {
      const controller = new FileIgnoreController("")
      await controller.initialize()

      expect(controller.validateAccess("/some/file.ts")).toBe(false)
      expect(controller.validateAccess("relative/file.ts")).toBe(false)
    })

    it("filterPaths returns empty array", async () => {
      const controller = new FileIgnoreController("")
      await controller.initialize()

      expect(controller.filterPaths(["/some/file.ts", "other.ts"])).toEqual([])
    })
  })
})
