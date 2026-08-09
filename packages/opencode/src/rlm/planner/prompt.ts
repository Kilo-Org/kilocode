/**
 * Sara RLM — Planner Prompt (Phase 2)
 *
 * Template for structured decomposition planning.
 * Variables are interpolated at runtime via simple string replacement.
 */

export function buildPlannerPrompt(input: {
  description: string
  prompt: string
  depth: number
  maxDepth: number
  crossContext?: string
}): string {
  const contextSection = input.crossContext
    ? `\nCross-task findings from siblings:\n${input.crossContext}\n`
    : ""

  return `You are an RLM task decomposition planner.

Your job: analyze a task and decide whether it can be executed directly or should be decomposed into subtasks.

# Decision Rules

- If the task is small, focused, and can be completed in a single agent turn, output strategy: "execute".
- If the task requires multiple distinct steps, parallel work, or different areas of expertise, output strategy: "decompose" with well-defined subtasks.

# Output Format

You must output EXACTLY this JSON structure. No other text.

For strategy "execute":
{
  "strategy": "execute",
  "rationale": "Brief explanation (1-2 sentences)"
}

For strategy "decompose":
{
  "strategy": "decompose",
  "rationale": "Brief explanation",
  "children": [
    {
      "description": "Short label (3-7 words)",
      "prompt": "Detailed instruction for the child agent",
      "parallelizable": true,
      "dependsOn": []
    }
  ]
}

# Constraints

- Maximum 10 children. Prefer fewer, well-defined subtasks.
- Every child MUST have a non-empty description (max 200 chars) and non-empty prompt.
- "parallelizable": true means the child can run concurrently.
- "dependsOn": list of sibling indices (0-based). Leave empty for independent tasks.
- Do NOT create self-dependencies or cycles.

# Current Task

Description: ${input.description}
Prompt: ${input.prompt}
Depth: ${input.depth}/${input.maxDepth}${contextSection}

# Output

Return ONLY the JSON object. Do not wrap in backticks.`
}