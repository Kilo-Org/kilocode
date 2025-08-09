import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { readDirectory } from "../fs"

describe("readDirectory", () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "readDir-"))
    })

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    it("returns all files recursively", async () => {
        await fs.mkdir(path.join(tempDir, "sub"), { recursive: true })
        await fs.writeFile(path.join(tempDir, "a.txt"), "")
        await fs.writeFile(path.join(tempDir, "sub", "b.txt"), "")

        const files = await readDirectory(tempDir)
        const expected = [
            path.join(tempDir, "a.txt"),
            path.join(tempDir, "sub", "b.txt"),
        ]
        expect(files.sort()).toEqual(expected.sort())
    })

    it("excludes specified paths", async () => {
        await fs.mkdir(path.join(tempDir, "ignore"), { recursive: true })
        await fs.writeFile(path.join(tempDir, "ignore", "c.txt"), "")
        await fs.writeFile(path.join(tempDir, "keep.txt"), "")

        const files = await readDirectory(tempDir, [["ignore"]])
        expect(files).toEqual([path.join(tempDir, "keep.txt")])
    })

    it("filters OS generated files", async () => {
        await fs.writeFile(path.join(tempDir, "Thumbs.db"), "")
        await fs.writeFile(path.join(tempDir, "file.txt"), "")
        const files = await readDirectory(tempDir)
        expect(files).toEqual([path.join(tempDir, "file.txt")])
    })
})

