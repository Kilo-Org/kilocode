import type { FileDiffInfo, PromptFileAttachment, SessionMessageAssistantTool } from "@opencode/client"

export function toolOutput(item: SessionMessageAssistantTool) {
  if (!("content" in item.state)) return ""
  return item.state.content?.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n") ?? ""
}

export function attachmentUri(file: PromptFileAttachment) {
  return file.data ? `data:${file.mime};base64,${file.data}` : file.source.type === "uri" ? file.source.uri : ""
}

export function relativizeProjectPath(path: string, directory?: string) {
  if (!path || !directory || directory === "/" || directory === "\\") return path
  const target = path.replaceAll("\\", "/")
  const root = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  if (target === root) return ""
  return target.startsWith(root + "/") ? target.slice(root.length + 1) : path
}

export function fileDiffs(value: unknown) {
  if (!Array.isArray(value)) return []
  const items: unknown[] = value
  return items.filter(
    (file): file is FileDiffInfo =>
      !!file &&
      typeof file === "object" &&
      "file" in file &&
      "patch" in file &&
      "additions" in file &&
      "deletions" in file &&
      "status" in file &&
      typeof file.file === "string" &&
      typeof file.patch === "string" &&
      typeof file.additions === "number" &&
      typeof file.deletions === "number" &&
      (file.status === "added" || file.status === "deleted" || file.status === "modified"),
  )
}
