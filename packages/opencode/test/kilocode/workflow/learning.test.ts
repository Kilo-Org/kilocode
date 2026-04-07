import { describe, test, expect, beforeEach } from "bun:test"
import {
  Lesson,
  LessonStore,
  isInfraNoise,
  extractFromAgentReport,
  formatLessonsForPrompt,
} from "@/devilcode/workflow/learning"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("isInfraNoise", () => {
  test("detects timeout", () => expect(isInfraNoise("connection timed out")).toBe(true))
  test("detects 503", () => expect(isInfraNoise("server returned 503")).toBe(true))
  test("detects OOM", () => expect(isInfraNoise("out of memory")).toBe(true))
  test("passes real errors", () => expect(isInfraNoise("missing export in module")).toBe(false))
  test("detects ECONNREFUSED", () => expect(isInfraNoise("econnrefused on port 3000")).toBe(true))
})

describe("extractFromAgentReport", () => {
  test("extracts valid lesson", () => {
    const lesson = extractFromAgentReport({
      trigger: "Import failed because the module used default export",
      resolution: "Changed import to use default import syntax instead of named",
      files: ["src/api.ts"],
    })
    expect(lesson).not.toBeNull()
    expect(lesson!.trigger).toContain("Import failed")
    expect(lesson!.resolution).toContain("Changed import")
  })

  test("rejects missing trigger", () => {
    const lesson = extractFromAgentReport({ trigger: "", resolution: "fixed it", files: ["a.ts"] })
    expect(lesson).toBeNull()
  })

  test("rejects short trigger", () => {
    const lesson = extractFromAgentReport({ trigger: "error", resolution: "fixed the error completely", files: ["a.ts"] })
    expect(lesson).toBeNull()
  })

  test("rejects infra noise in trigger", () => {
    const lesson = extractFromAgentReport({
      trigger: "connection timed out while fetching data",
      resolution: "Changed the retry strategy to handle timeouts",
      files: ["a.ts"],
    })
    expect(lesson).toBeNull()
  })

  test("rejects no action verb in resolution", () => {
    const lesson = extractFromAgentReport({
      trigger: "The module was not found when building",
      resolution: "the module path was wrong in the config",
      files: ["a.ts"],
    })
    expect(lesson).toBeNull()
  })

  test("rejects empty files array", () => {
    const lesson = extractFromAgentReport({
      trigger: "Module not found during build process",
      resolution: "Added the missing module to package.json",
      files: [],
    })
    expect(lesson).toBeNull()
  })
})

describe("LessonStore", () => {
  let tmpDir: string
  let store: LessonStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lessons-test-"))
    store = new LessonStore(tmpDir)
  })

  test("save and list lessons", async () => {
    const lesson: Lesson = {
      id: "L-001",
      scope: "project",
      category: "code_pattern",
      title: "Test lesson",
      trigger: "trigger text here that is long enough",
      resolution: "resolution text here that is long enough",
      files: ["a.ts"],
      confidence: 0.5,
      hitCount: 1,
      createdAt: new Date().toISOString(),
    }
    await store.save(lesson)
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe("L-001")
  })

  test("search filters by query", async () => {
    const lesson1: Lesson = {
      id: "L-001", scope: "project", category: "code_pattern",
      title: "Import error fix", trigger: "module not found", resolution: "added import",
      files: ["a.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    const lesson2: Lesson = {
      id: "L-002", scope: "project", category: "command_failure",
      title: "Build script fix", trigger: "build failed", resolution: "fixed script",
      files: ["b.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    await store.save(lesson1)
    await store.save(lesson2)
    const results = await store.search("import")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("L-001")
  })

  test("incrementHit increases count and confidence", async () => {
    const lesson: Lesson = {
      id: "L-001", scope: "project", category: "code_pattern",
      title: "Test", trigger: "test trigger for the lesson", resolution: "test resolution",
      files: ["a.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    await store.save(lesson)
    await store.incrementHit("L-001")
    const updated = (await store.list())[0]
    expect(updated.hitCount).toBe(2)
    expect(updated.confidence).toBeGreaterThan(0.5)
  })
})

describe("formatLessonsForPrompt", () => {
  test("formats lessons grouped by category", () => {
    const lessons: Lesson[] = [
      {
        id: "L-001", scope: "project", category: "code_pattern",
        title: "Use named exports", trigger: "default exports break tree-shaking",
        resolution: "Changed to named exports", files: ["a.ts"],
        confidence: 0.9, hitCount: 5, createdAt: new Date().toISOString(),
      },
      {
        id: "L-002", scope: "project", category: "command_failure",
        title: "Bun test needs cd", trigger: "tests fail from root",
        resolution: "Added cd to packages/opencode", files: [],
        confidence: 0.3, hitCount: 1, createdAt: new Date().toISOString(),
      },
    ]
    const text = formatLessonsForPrompt(lessons)
    expect(text).toContain("Lessons Learned")
    expect(text).toContain("(proven)")
    expect(text).toContain("(tentative)")
    expect(text).toContain("code_pattern")
    expect(text).toContain("command_failure")
  })

  test("returns empty string for no lessons", () => {
    expect(formatLessonsForPrompt([])).toBe("")
  })
})
