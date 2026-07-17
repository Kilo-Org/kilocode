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
    fileScope?: ConfigVariable.FileScope & { authorize?: ConfigVariableGuard.Authorize }
    sourceScope?: ConfigVariable.FileScope & { authorize?: ConfigVariableGuard.Authorize }
    authorize?: ConfigVariableGuard.Authorize
  }

  export function read(item: string, options: Options) {
    const scope = options.sourceScope ?? options.fileScope
    if (options.trusted && !options.authorize) return Filesystem.readText(item)
    if (!scope && !options.authorize) {
      throw new InvalidError({
        path: item,
        message: "project markdown cannot be read without a project scope",
      })
    }
    return ConfigVariableGuard.read(item, {
      ...scope,
      token: `markdown source "${item}"`,
      authorize: options.authorize,
    })
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
      authorize: options.authorize,
    })
  }
}
