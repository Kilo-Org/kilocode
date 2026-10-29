type Scope = "global" | "project"

/**
 * The file an edit must land in so the merged config changes. `source` already resolves a legacy spelling of the
 * path; a project document also wins when it only defines the parent section, because core replaces the whole
 * top-level value of a document rather than merging into it.
 */
export function writeScope(source: (path: string[]) => Scope | undefined, path: string[]): Scope {
  if (source(path) === "project") return "project"
  if (path.length > 1 && source([path[0]!]) === "project") return "project"
  return source(path) ?? "global"
}
