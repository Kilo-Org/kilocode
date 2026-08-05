import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser"
import { mkdir, stat } from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { ConfigParse } from "@/config/parse"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { KilocodeConfigOverlay } from "./overlay"

export namespace KilocodeConfigWriter {
  export type Conflict = {
    ok: false
    code: "target-changed" | "revision-conflict" | "target-not-writable"
    message: string
    target: KilocodeConfigOverlay.Target
  }

  export type Result = { ok: true; target: KilocodeConfigOverlay.Target } | Conflict

  export async function write(input: {
    directory: string
    worktree?: string
    scope: KilocodeConfigOverlay.Scope
    expected?: { path: string; revision: string }
    set?: Record<string, unknown>
    unset?: string[][]
    write?: typeof Filesystem.write
    beforeWrite?: () => Promise<void>
  }): Promise<Result> {
    const target = await KilocodeConfigOverlay.target(input)
    const expected = input.expected
    if (expected && target.path !== expected.path) {
      return { ok: false, code: "target-changed", message: "The authoritative config target changed.", target }
    }
    if (expected && target.revision !== expected.revision) {
      return { ok: false, code: "revision-conflict", message: "The config file changed since it was read.", target }
    }
    if (!target.writable) {
      return {
        ok: false,
        code: "target-not-writable",
        message: "The config target is outside its allowed root or is not writable.",
        target,
      }
    }

    const patch = KilocodeConfigOverlay.patch({ scope: input.scope, set: input.set, unset: input.unset })
    if (Object.keys(patch).length === 0) return { ok: true, target }
    await mkdir(path.dirname(target.path), { recursive: true })
    await input.beforeWrite?.()
    const checked = await KilocodeConfigOverlay.target(input)
    if ((expected && checked.path !== expected.path) || !checked.writable) {
      return {
        ok: false,
        code: "target-not-writable",
        message: "The config target changed or escaped its allowed root.",
        target: checked,
      }
    }
    const before = checked.exists ? await Bun.file(checked.path).text() : "{}"
    if (
      expected &&
      KilocodeConfigOverlay.revision(checked.path, checked.exists, checked.exists ? before : "") !== expected.revision
    ) {
      return {
        ok: false,
        code: "revision-conflict",
        message: "The config file changed since it was read.",
        target: checked,
      }
    }
    const updated = patchJsonc(before, patch)
    ConfigParse.schema(Config.Info, ConfigParse.jsonc(updated, checked.path), checked.path)
    const mode = checked.exists
      ? await stat(checked.path).then((info) => info.mode & 0o777)
      : checked.scope === "global"
        ? 0o600
        : undefined
    if (updated !== before) await (input.write ?? Filesystem.write)(checked.path, updated, mode)
    return { ok: true, target: await KilocodeConfigOverlay.target(input) }
  }

  function patchJsonc(input: string, patch: unknown, parts: string[] = []): string {
    if (!isRecord(patch)) {
      if (patch === null) {
        // jsonc-parser cannot delete a nested path when its parent is absent.
        const tree = parseTree(input)
        if (!tree || !findNodeAtLocation(tree, parts)) return input
      }
      return applyEdits(
        input,
        modify(input, parts, patch === null ? undefined : patch, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      )
    }
    if (parts.length > 0) {
      const tree = parseTree(input)
      const node = tree && findNodeAtLocation(tree, parts)
      if (node && node.type !== "object") {
        const replacement = parts[0] === "permission" && parts.length === 2 ? { "*": node.value, ...patch } : patch
        return applyEdits(
          input,
          modify(input, parts, replacement, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
        )
      }
    }
    return Object.entries(patch).reduce((text, [key, value]) => patchJsonc(text, value, [...parts, key]), input)
  }
}
