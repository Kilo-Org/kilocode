import * as fs from "fs"

export function ensureServerCwd(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Parse the server URL from Kilo v2 `serve --stdio` output: the first complete JSON line
 * `{"url":"http://127.0.0.1:12345"}`. Returns undefined until that line is complete.
 */
export function parseServerUrl(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .slice(0, -1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map(url)
    .find((value) => value !== undefined)
}

export function scanServerUrl(output: string, chunk: string, limit: number) {
  const text = `${output}${chunk}`
  return { output: text.slice(-limit), url: parseServerUrl(text) }
}

function url(line: string) {
  const value = json(line)
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") return undefined
  return URL.canParse(value.url) ? value.url : undefined
}

// Other stdout lines can start with "{" too. A line that is not JSON is not the URL line.
function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
