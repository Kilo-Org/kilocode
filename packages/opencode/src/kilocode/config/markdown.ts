import { ConfigVariable } from "@/config/variable"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { Filesystem } from "@/util/filesystem"
import { ConfigVariableGuard } from "./variable"

export namespace KilocodeMarkdown {
  export type Source = {
    trusted: boolean
    source: string
    root?: string
  }

  export type Options = {
    trusted: boolean
    fileScope?: ConfigVariable.FileScope
    sourceScope?: ConfigVariable.FileScope
  }

  export function read(item: string, options: Options) {
    if (options.trusted) return Filesystem.readText(item)
    const scope = options.sourceScope ?? options.fileScope
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
