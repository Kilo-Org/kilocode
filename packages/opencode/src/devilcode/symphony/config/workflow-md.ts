import matter from "gray-matter"
import { SymphonyConfig } from "./schema"
import { SymphonyConfigError } from "../errors"

interface ParsedWorkflow {
  config: SymphonyConfig
  promptTemplate: string
}

export function parseWorkflowMd(content: string): ParsedWorkflow {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch (e) {
    throw new SymphonyConfigError({
      message: `Invalid YAML in WORKFLOW.md frontmatter: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  const data = parsed.data
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SymphonyConfigError({
      message: "WORKFLOW.md frontmatter must decode to a YAML map",
    })
  }

  if (Object.keys(data).length === 0) {
    throw new SymphonyConfigError({
      message: "WORKFLOW.md must have YAML frontmatter with tracker configuration",
    })
  }

  const result = SymphonyConfig.safeParse(data)
  if (!result.success) {
    throw new SymphonyConfigError({
      message: `Invalid WORKFLOW.md config: ${result.error.message}`,
    })
  }

  const promptTemplate = parsed.content.trim()
  if (!promptTemplate) {
    throw new SymphonyConfigError({
      message: "WORKFLOW.md must have a prompt template after the frontmatter",
    })
  }

  return { config: result.data, promptTemplate }
}
