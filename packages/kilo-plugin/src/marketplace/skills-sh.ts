export * as SkillsShRegistry from "./skills-sh"

import { Option, Schema } from "effect"
import type { Entry, Registry } from "./registry"

// skills.sh (https://skills.sh), the open directory of Agent Skills hosted in GitHub repositories. Its documented
// `/api/v1` needs a Vercel OIDC token, so this adapter uses the public endpoints the website uses: the all-time
// leaderboard (200 skills per page) without a query, and search with one. The listing has no descriptions or
// archives; a skill installs from the GitHub tarball of its repository, selecting the skill's directory.
const BASE = "https://skills.sh"
// Only GitHub-backed sources (`owner/repo`) can be installed; other hosts have no known download.
const GITHUB_SOURCE = /^[\w.-]+\/[\w.-]+$/

const RawSkill = Schema.Struct({
  source: Schema.String,
  skillId: Schema.String,
  name: Schema.optional(Schema.String),
  installs: Schema.optional(Schema.Number),
  isOfficial: Schema.optional(Schema.Boolean),
})
const decodeList = Schema.decodeUnknownOption(Schema.Struct({ skills: Schema.Array(Schema.Unknown) }))
const decodeSkill = Schema.decodeUnknownOption(RawSkill)

export function make(input: { fetch?: typeof fetch; base?: string } = {}): Registry {
  const request = input.fetch ?? fetch
  const base = input.base ?? BASE
  return {
    id: "skills.sh",
    name: "skills.sh",
    description: "The open Agent Skills directory: community skills from GitHub, not reviewed by Kilo",
    kinds: ["skill"],
    curated: false,
    searchable: true,
    list: async (kind, query) => {
      if (kind !== "skill") return []
      const url = query?.trim()
        ? `${base}/api/search?q=${encodeURIComponent(query.trim())}&limit=100`
        : `${base}/api/skills/all-time/0`
      const response = await request(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`skills.sh returned HTTP ${response.status}`)
      return parse(await response.json())
    },
  }
}

export function parse(body: unknown): Entry[] {
  const list = decodeList(body)
  if (Option.isNone(list)) throw new Error("skills.sh returned an unexpected document")
  const seen = new Set<string>()
  return list.value.skills.flatMap((raw) => {
    const skill = Option.getOrUndefined(decodeSkill(raw))
    if (!skill || !GITHUB_SOURCE.test(skill.source)) return []
    // The item id is `<owner>/<repo>/<skill>`: skill names repeat across repositories (forks, mirrors).
    const id = `${skill.source}/${skill.skillId}`
    if (seen.has(id)) return []
    seen.add(id)
    const installs = skill.installs === undefined ? undefined : `${compact(skill.installs)} installs`
    return [
      {
        item: {
          registry: "skills.sh",
          kind: "skill" as const,
          id,
          name: skill.name ?? skill.skillId,
          description: [skill.source, installs, skill.isOfficial ? "official" : undefined].filter(Boolean).join(" · "),
          author: skill.source.split("/")[0],
          url: `https://skills.sh/${skill.source}/${skill.skillId}`,
          tags: [],
          prerequisites: [],
          parameters: [],
          options: [],
        },
        archive: `https://codeload.github.com/${skill.source}/tar.gz/HEAD`,
        select: skill.skillId,
        payloads: [],
      },
    ]
  })
}

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value)
}
