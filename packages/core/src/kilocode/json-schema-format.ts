// zod 4.6 emits non-standard JSON Schema `format` values for string checks
// (`startsWith`, `endsWith`, `includes`) next to an equivalent `pattern`.
// Strict providers reject unknown formats, so tool schemas drop them and keep
// the pattern, which is what zod emitted before 4.6.
const formats = new Set(["starts_with", "ends_with", "includes"])

export function stripZodFormat(ctx: { jsonSchema: { format?: string } }) {
  if (ctx.jsonSchema.format && formats.has(ctx.jsonSchema.format)) delete ctx.jsonSchema.format
}
