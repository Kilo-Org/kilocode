import { Schema } from "effect"

type Data = Readonly<Record<string, typeof Schema.Json.Type>>
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const patch = { patch: Schema.String, additions: count, deletions: count }
const File = Schema.Struct({ ...patch, file: Schema.String })
const Patched = Schema.Array(
  Schema.Struct({ ...patch, relativePath: Schema.String, type: Schema.Literals(["add", "update", "move", "delete"]) }),
)

/** Convert only saved tool data. File names describe the remote checkout and never authorize a read. */
export function legacyEdit(name: string, input: Data, metadata: Data | undefined) {
  if (name === "apply_patch" && Schema.is(Patched)(metadata?.files)) {
    const files = metadata.files.map((f) => ({
      file: f.relativePath,
      patch: f.patch,
      additions: f.additions,
      deletions: f.deletions,
      status: f.type === "add" ? "added" : f.type === "delete" ? "deleted" : "modified",
    }))
    return { name: "patch", input, metadata: { ...metadata, files } }
  }
  if (name !== "edit" && name !== "write") return { name, input, metadata }
  const normalized = typeof input.filePath === "string" ? { ...input, path: input.filePath } : input
  const file = metadata?.filediff
  if (!Schema.is(File)(file)) return { name, input: normalized, metadata }
  return {
    name,
    input: normalized,
    metadata: {
      ...metadata,
      files: [
        {
          file: file.file,
          patch: file.patch,
          additions: file.additions,
          deletions: file.deletions,
          status: metadata?.exists === false ? "added" : "modified",
        },
      ],
    },
  }
}
