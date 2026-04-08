import z from "zod"
import fs from "fs/promises"
import path from "path"

export const Lesson = z.object({
  id: z.string(),
  scope: z.enum(["global", "project"]),
  category: z.enum(["code_pattern", "command_failure", "review_failure", "infra_timeout"]),
  title: z.string(),
  trigger: z.string(),
  resolution: z.string(),
  files: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  hitCount: z.number().int().min(1).default(1),
  createdAt: z.string(),
})
export type Lesson = z.infer<typeof Lesson>

const INFRA_NOISE_PATTERNS = [
  "timeout",
  "timed out",
  "etimedout",
  "connection refused",
  "econnrefused",
  "econnreset",
  "server down",
  "server unavailable",
  "service unavailable",
  "503",
  "502",
  "504",
  "database is locked",
  "db lock",
  "oom",
  "out of memory",
  "killed",
  "disk full",
  "no space left",
  "sigkill",
  "sigterm",
]

const ACTION_VERBS = new Set([
  "changed",
  "replaced",
  "removed",
  "added",
  "fixed",
  "updated",
  "switched",
  "moved",
  "renamed",
  "set",
  "used",
  "imported",
  "configured",
  "wrapped",
  "converted",
])

export function isInfraNoise(text: string): boolean {
  const lower = text.toLowerCase()
  return INFRA_NOISE_PATTERNS.some((p) => lower.includes(p))
}

export function extractFromAgentReport(data: {
  trigger: string
  resolution: string
  files: string[]
  taskTitle?: string
  category?: string
}): Lesson | null {
  const { trigger, resolution, files, taskTitle, category } = data

  if (!trigger || trigger.length <= 10) return null
  if (!resolution || resolution.length <= 10) return null
  if (!files || files.length === 0) return null
  if (isInfraNoise(trigger) || isInfraNoise(resolution)) return null

  const words = new Set(resolution.toLowerCase().split(/\s+/))
  if (![...words].some((w) => ACTION_VERBS.has(w))) return null

  const title = taskTitle
    ? `[${taskTitle.slice(0, 30)}] ${trigger.slice(0, 60)}`
    : trigger.slice(0, 60)

  const id = `L-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    scope: "project",
    category: (category as Lesson["category"]) ?? "code_pattern",
    title,
    trigger,
    resolution,
    files,
    confidence: 0.5,
    hitCount: 1,
    createdAt: new Date().toISOString(),
  }
}

export class LessonStore {
  private lessonsDir: string

  constructor(planningDir: string) {
    this.lessonsDir = path.join(planningDir, "lessons")
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.lessonsDir, { recursive: true })
  }

  async save(lesson: Lesson): Promise<void> {
    await this.ensureDir()
    const filePath = path.join(this.lessonsDir, `${lesson.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(lesson, null, 2))
  }

  async list(): Promise<Lesson[]> {
    await this.ensureDir()
    const files = await fs.readdir(this.lessonsDir)
    const lessons: Lesson[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const raw = await fs.readFile(path.join(this.lessonsDir, file), "utf-8")
        lessons.push(Lesson.parse(JSON.parse(raw)))
      } catch {
        // skip malformed
      }
    }
    return lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async search(query: string): Promise<Lesson[]> {
    const all = await this.list()
    const lower = query.toLowerCase()
    return all.filter(
      (l) =>
        l.title.toLowerCase().includes(lower) ||
        l.trigger.toLowerCase().includes(lower) ||
        l.resolution.toLowerCase().includes(lower),
    )
  }

  async incrementHit(lessonId: string): Promise<void> {
    const filePath = path.join(this.lessonsDir, `${lessonId}.json`)
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const lesson = Lesson.parse(JSON.parse(raw))
      lesson.hitCount += 1
      lesson.confidence = Math.min(1.0, lesson.confidence + 0.1)
      await fs.writeFile(filePath, JSON.stringify(lesson, null, 2))
    } catch {
      // lesson not found
    }
  }
}

export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return ""

  const byCategory = new Map<string, Lesson[]>()
  for (const lesson of lessons) {
    const existing = byCategory.get(lesson.category) ?? []
    existing.push(lesson)
    byCategory.set(lesson.category, existing)
  }

  const lines: string[] = ["## Lessons Learned (DO NOT repeat these mistakes)\n"]
  for (const [category, categoryLessons] of byCategory) {
    lines.push(`### ${category}\n`)
    for (const lesson of categoryLessons) {
      const tag = lesson.confidence >= 0.8 ? " (proven)" : lesson.confidence < 0.4 ? " (tentative)" : ""
      lines.push(`- **${lesson.title}**${tag}: ${lesson.resolution}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
