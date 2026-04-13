/**
 * Speech Text Filter — Cleans assistant response text for natural TTS output.
 *
 * Strips markdown formatting, code blocks, URLs, file paths, tool use blocks,
 * and other content that sounds unnatural when spoken aloud.
 *
 * Used by auto-speak and preview before passing text to SpeechEngine.
 */

/**
 * Clean text for speech synthesis.
 * Removes markdown, code blocks, URLs, paths, and tool artifacts.
 *
 * GUARDRAILS — 25 rules ensuring agents NEVER speak code:
 *
 * Layer 1: Structural code removal (rules 1-3)
 *   - Fenced code blocks, indented code blocks, inline code
 * Layer 2: Tool/command artifact removal (rules 4-7)
 *   - Tool use markers, terminal output, diff hunks, stack traces
 * Layer 3: Identifier/syntax removal (rules 8-10)
 *   - CamelCase chains, dot-chains, bracket expressions
 * Layer 4: Markdown cleanup (rules 11-22)
 *   - Headings, bold/italic, links, URLs, paths, lists, etc.
 * Layer 5: Safety limits (rules 23-25)
 *   - Whitespace collapse, verbosity trim, length cap
 */
export function filterTextForSpeech(text: string, verbosity: "brief" | "normal" | "detailed" = "normal"): string {
  let result = text

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 1: STRUCTURAL CODE REMOVAL — catch code before anything else
  // ═══════════════════════════════════════════════════════════════════════

  // 1. Remove fenced code blocks (``` ... ```) — NEVER speak code
  result = result.replace(/```[\s\S]*?```/g, " (code block omitted) ")

  // 2. Remove indented code blocks (4+ spaces or tab at line start, 2+ consecutive lines)
  result = result.replace(/(?:^(?:[ ]{4}|\t).+\n?){2,}/gm, " (code block omitted) ")

  // 3. Remove inline code (`...`) — speak the content without backticks
  result = result.replace(/`([^`]+)`/g, "$1")

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 2: TOOL/COMMAND ARTIFACT REMOVAL — strip agent operational noise
  // ═══════════════════════════════════════════════════════════════════════

  // 4. Remove tool use blocks ("Running bash command...", "Executing...", etc.)
  result = result.replace(/^(?:Running|Executing|Reading|Writing|Searching|Fetching|Installing|Building|Compiling)\s.*$/gm, "")

  // 5. Remove terminal/shell output lines ($ prompt, > prompt, lines starting with common prefixes)
  result = result.replace(/^\s*[$>]\s+.+$/gm, "")
  result = result.replace(/^\s*(?:npm|yarn|pnpm|pip|cargo|go|docker|git|curl|wget)\s+.+$/gm, "")

  // 6. Remove diff hunks (@@ ... @@, +/- lines)
  result = result.replace(/^@@\s.*@@.*$/gm, "")
  result = result.replace(/^[+-]{1,3}\s.*$/gm, "")

  // 7. Remove stack traces and error paths
  result = result.replace(/^\s+at\s+\S+.*$/gm, "")  // "    at Object.method (file:line)"
  result = result.replace(/^\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):.*$/gm, " (error details omitted) ")

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 3: CODE IDENTIFIER REMOVAL — catch leaked code syntax
  // ═══════════════════════════════════════════════════════════════════════

  // 8. Remove long dot-chains (object.property.method.call) — code artifacts
  result = result.replace(/\b\w+(?:\.\w+){3,}\b/g, " (code reference) ")

  // 9. Remove function call patterns: functionName(...) with 3+ args or complex content
  result = result.replace(/\b\w+\([^)]{50,}\)/g, " (code reference) ")

  // 10. Remove JSON-like blocks ({ "key": "value" ... })
  result = result.replace(/\{[^}]*"[^"]*"\s*:\s*[^}]*\}/g, " (data omitted) ")

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 4: MARKDOWN CLEANUP — make prose speakable
  // ═══════════════════════════════════════════════════════════════════════

  // 11. Remove markdown headings (# ## ### etc.) — speak the text
  result = result.replace(/^#{1,6}\s+/gm, "")

  // 12. Remove markdown bold/italic markers
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, "$1")  // ***bold italic***
  result = result.replace(/\*\*(.+?)\*\*/g, "$1")       // **bold**
  result = result.replace(/\*(.+?)\*/g, "$1")            // *italic*
  result = result.replace(/__(.+?)__/g, "$1")            // __bold__
  result = result.replace(/_(.+?)_/g, "$1")              // _italic_

  // 13. Remove markdown links — speak the link text, skip URL
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

  // 14. Remove raw URLs
  result = result.replace(/https?:\/\/[^\s)]+/g, " (link) ")

  // 15. Remove file paths (Unix and Windows style)
  result = result.replace(/(?:\/[\w.-]+){3,}/g, " (file path) ")       // /usr/local/bin/...
  result = result.replace(/[A-Z]:\\[\w\\.-]+/g, " (file path) ")       // C:\Users\...

  // 16. Remove markdown horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, "")

  // 17. Remove markdown list markers but keep content
  result = result.replace(/^\s*[-*+]\s+/gm, "")          // - item → item
  result = result.replace(/^\s*\d+\.\s+/gm, "")          // 1. item → item

  // 18. Remove blockquotes markers
  result = result.replace(/^\s*>\s*/gm, "")

  // 19. Remove HTML tags
  result = result.replace(/<[^>]+>/g, "")

  // 20. Remove markdown image syntax
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")

  // 21. Remove markdown table pipes and formatting
  result = result.replace(/\|/g, ",")
  result = result.replace(/^[-:| ]+$/gm, "")  // table separator rows

  // 22. Remove strikethrough
  result = result.replace(/~~(.+?)~~/g, "$1")

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 5: SAFETY LIMITS — final cleanup and length enforcement
  // ═══════════════════════════════════════════════════════════════════════

  // 23. Collapse repeated whitespace and newlines
  result = result.replace(/\n{3,}/g, "\n\n")
  result = result.replace(/[ \t]{2,}/g, " ")
  result = result.trim()

  // 24. Brief mode: only first paragraph
  if (verbosity === "brief") {
    const firstPara = result.split(/\n\n/)[0]
    if (firstPara) result = firstPara
  }

  // 25a. Collapse multiple omission markers
  result = result.replace(/(\(code block omitted\)\s*){2,}/g, "(code blocks omitted) ")
  result = result.replace(/(\(code reference\)\s*){2,}/g, "(code reference) ")
  result = result.replace(/(\(file path\)\s*){2,}/g, "(file paths) ")
  result = result.replace(/(\(error details omitted\)\s*){2,}/g, "(error omitted) ")
  result = result.replace(/(\(data omitted\)\s*){2,}/g, "(data omitted) ")
  result = result.replace(/(\(link\)\s*){2,}/g, "(links) ")

  // 25b. Limit length for speech (don't try to speak 10,000 characters)
  const maxLen = verbosity === "detailed" ? 4000 : verbosity === "brief" ? 500 : 2000
  if (result.length > maxLen) {
    result = result.slice(0, maxLen) + "..."
  }

  return result.trim()
}

/**
 * Detect basic sentiment from text content.
 * Returns a pitch/rate modifier for voice synthesis.
 *
 * Uses simple keyword matching — no ML overhead.
 */
export function detectSentiment(text: string): {
  mood: "positive" | "negative" | "neutral"
  pitchModifier: number   // semitones: +1 for positive, -1 for negative
  rateModifier: number    // multiplier: 1.05 for positive, 0.95 for negative
} {
  const lower = text.toLowerCase()

  const positiveWords = [
    "success", "complete", "completed", "done", "fixed", "working", "works",
    "passed", "resolved", "perfect", "excellent", "great", "good",
    "created", "built", "finished", "ready", "approved", "merged",
  ]
  const negativeWords = [
    "error", "failed", "failure", "crash", "bug", "broken", "issue",
    "problem", "exception", "timeout", "denied", "rejected", "invalid",
    "missing", "cannot", "unable", "fatal", "critical", "warning",
  ]

  let positiveCount = 0
  let negativeCount = 0

  for (const word of positiveWords) {
    if (lower.includes(word)) positiveCount++
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) negativeCount++
  }

  if (positiveCount > negativeCount + 1) {
    return { mood: "positive", pitchModifier: 1, rateModifier: 1.05 }
  }
  if (negativeCount > positiveCount + 1) {
    return { mood: "negative", pitchModifier: -1, rateModifier: 0.95 }
  }
  return { mood: "neutral", pitchModifier: 0, rateModifier: 1.0 }
}
