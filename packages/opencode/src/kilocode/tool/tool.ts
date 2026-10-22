import { Schema, SchemaIssue } from "effect"

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()
const count = 20
const limit = 4 * 1024

export function format(error: unknown) {
  if (!Schema.isSchemaError(error)) {
    return String(error)
  }
  const result = formatter(error.issue)
  if (result.issues.length === 0) {
    return "The input did not match the expected schema. Please rewrite the arguments so they satisfy it."
  }
  const issues = result.issues.slice(0, count)
  const lines: string[] = []
  for (const issue of issues) {
    const line = `${path(issue.path)}: ${reason(issue.message)}`
    const more = result.issues.length - lines.length - 1
    const suffix = more > 0 ? `\n…and ${more} more` : ""
    if ([...lines, line].join("\n").length + suffix.length > limit) {
      break
    }
    lines.push(line)
  }
  const more = result.issues.length - lines.length
  const suffix = more > 0 ? `\n…and ${more} more` : ""
  if (lines.length > 0) {
    return `${lines.join("\n")}${suffix}`
  }
  const line = `${path(issues[0].path)}: ${reason(issues[0].message)}`
  const rest = result.issues.length - 1
  const tail = rest > 0 ? `\n…and ${rest} more` : ""
  return `${line.slice(0, limit - tail.length - 1)}…${tail}`
}

function path(keys: ReadonlyArray<unknown> | undefined) {
  const value = (keys ?? [])
    .map((key) => {
      const segment = typeof key === "object" && key !== null && "key" in key ? key.key : key
      return typeof segment === "number" ? `[${segment}]` : `[${JSON.stringify(String(segment))}]`
    })
    .join("")
  return value || "input"
}

function reason(message: string) {
  if (message.toLowerCase().includes("required")) {
    return message
  }
  if (/\bmissing\b/i.test(message)) {
    return "is missing and is required"
  }
  return message
}
