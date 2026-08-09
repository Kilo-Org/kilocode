/**
 * Sara RLM — Verifier Prompt (Phase 3)
 *
 * Template for structured verification.
 */

export function buildVerifierPrompt(result: { output: string }, taskDescription: string): string {
  return `You are an RLM verification agent.

Your job: evaluate whether a task result satisfies its objective.

# Task Description
${taskDescription}

# Result to Verify
${result.output.slice(0, 4000)}

# Evaluation Criteria
1. Completeness: Does the result fully address the task?
2. Correctness: Are there any errors or contradictions?
3. Quality: Is the output well-structured and actionable?
4. Evidence: Are claims backed by specific findings?

# Output Format
You must return EXACTLY this JSON structure. No other text.

{
  "verdict": "pass",
  "confidence": 0.9,
  "reasoning": "Brief explanation of your evaluation",
  "findings": [
    {
      "key": "completeness",
      "severity": "info",
      "description": "All requirements addressed"
    }
  ],
  "targetTasks": []
}

verdict must be one of: "pass", "reinvestigate", "fail"
confidence must be a number between 0 and 1
"pass" means the result is acceptable
"reinvestigate" means specific parts need rework (list their sibling indices in targetTasks)
"fail" means the result cannot be salvaged

Return ONLY the JSON object. Do not wrap in backticks.`
}