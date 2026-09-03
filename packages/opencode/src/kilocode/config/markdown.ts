import { ConfigVariable } from "@/config/variable"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { Filesystem } from "@/util/filesystem"
import { ConfigVariableGuard } from "./variable"
import path from "node:path"

export namespace KilocodeMarkdown {
  export type Source = {
    trusted: boolean
    source: string
    root?: string
  }

  export type Options = {
    trusted: boolean
    fileScope?: ConfigVariable.FileScope
    sourceScope?: ConfigVariable.FileScope | readonly ConfigVariable.FileScope[]
  }

  export function read(item: string, options: Options) {
    if (options.trusted) return Filesystem.readText(item)
    const scope = Array.isArray(options.sourceScope)
      ? options.sourceScope.findLast((scope) => {
          const rel = path.relative(scope.source, item)
          return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
        })
      : (options.sourceScope ?? options.fileScope)
    if (!scope) {
      throw new InvalidError({
        path: item,
        message: "project markdown cannot be read without a project scope",
      })
    }
    return ConfigVariableGuard.read(item, { ...scope, token: `markdown source "${item}"` })
  }

  export function substitute(text: string, item: string, options: Options) {
    return ConfigVariable.substitute({
      text,
      type: "path",
      path: item,
      missing: "empty",
      escapeJson: false,
      trusted: options.trusted,
      fileScope: options.fileScope,
    })
  }
}
