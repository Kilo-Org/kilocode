type DiagnosticText = { source?: string; message: string; code?: string | number }

type Params = Record<string, string | DiagnosticText[]>

function diagnosticText(diagnostics?: DiagnosticText[]) {
  if (!diagnostics?.length) return ""
  return `\nCurrent problems detected:\n${diagnostics
    .map((d) => `- [${d.source || "Error"}] ${d.message}${d.code ? ` (${d.code})` : ""}`)
    .join("\n")}`
}

function fill(template: string, params: Params): string {
  return template.replace(/\${(.*?)}/g, (_, key) => {
    if (key === "diagnosticText") return diagnosticText(params.diagnostics as DiagnosticText[] | undefined)
    if (key in params) return String(params[key] ?? "")
    return ""
  })
}

type PromptType = "EXPLAIN" | "FIX" | "IMPROVE" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN"

const templates: Record<PromptType, string> = {
  EXPLAIN: `Explain the attached selection from \${filePath}:\${startLine}-\${endLine}
\${userInput}

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used`,

  FIX: `Fix any issues in the attached selection from \${filePath}:\${startLine}-\${endLine}
\${diagnosticText}
\${userInput}

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why`,

  IMPROVE: `Improve the attached selection from \${filePath}:\${startLine}-\${endLine}
\${userInput}

Please suggest improvements for:
1. Code readability and maintainability
2. Performance optimization
3. Best practices and patterns
4. Error handling and edge cases

Provide the improved code along with explanations for each enhancement.`,

  TERMINAL_FIX: `\${userInput}
Fix this terminal command:
\`\`\`
\${terminalContent}
\`\`\`

Please:
1. Identify any issues in the command
2. Provide the corrected command
3. Explain what was fixed and why`,

  TERMINAL_EXPLAIN: `\${userInput}
Explain this terminal command:
\`\`\`
\${terminalContent}
\`\`\`

Please provide:
1. What the command does
2. Explanation of each part/flag
3. Expected output and behavior`,
}

export function createPrompt(type: PromptType, params: Params): string {
  return fill(templates[type], params)
}

export type { PromptType }
