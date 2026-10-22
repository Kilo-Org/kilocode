import { FileDiff, type FileDiffOptions } from "@pierre/diffs"
import type { WorkerPoolManager } from "@pierre/diffs/worker"
import { createEffect, createMemo, on, onCleanup, splitProps, untrack, type ComponentProps, type JSX } from "solid-js"
import { File as BaseFile } from "@opencode-ai/ui/file"
import { createDefaultOptions, styleVariables } from "@kilocode/kilo-ui/pierre"
import { getWorkerPool } from "../pierre/worker"

const VirtualFile = BaseFile as unknown as (props: Record<string, unknown>) => JSX.Element

type File = {
  name: string
  contents: unknown
}

export type DiffProps<T = {}> = Omit<FileDiffOptions<T>, "diffStyle"> & {
  fileDiff?: unknown
  before?: File
  after?: File
  patch?: string
  diffStyle?: FileDiffOptions<T>["diffStyle"]
  annotations?: unknown[]
  onRendered?: () => void
  virtualized?: boolean
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

function value(file: File | undefined) {
  if (typeof file?.contents === "string") return file.contents
  return ""
}

function scheme(container: HTMLDivElement) {
  const host = container.querySelector("diffs-container")
  if (!(host instanceof HTMLElement)) return

  const color = document.documentElement.dataset.colorScheme
  if (color === "dark" || color === "light") {
    host.dataset.colorScheme = color
    return
  }

  host.removeAttribute("data-color-scheme")
}

function EagerDiff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  let instance: FileDiff<T> | undefined

  const [local, rest] = splitProps(props, [
    "fileDiff",
    "before",
    "after",
    "patch",
    "diffStyle",
    "class",
    "classList",
    "annotations",
    "onRendered",
    "virtualized",
  ])

  const options = createMemo(
    () =>
      ({
        ...createDefaultOptions<T>(local.diffStyle),
        ...rest,
      }) as unknown as FileDiffOptions<T>,
  )

  createEffect(
    on(
      () => {
        const before = local.before
        const after = local.after
        return {
          opts: options(),
          style: local.diffStyle,
          diff: local.fileDiff,
          before,
          after,
          old: value(before),
          next: value(after),
          beforeName: before?.name,
          afterName: after?.name,
          notes: local.annotations ?? [],
        }
      },
      (state, prev) => {
        const notes = state.notes as Parameters<FileDiff<T>["setLineAnnotations"]>[0]
        const same =
          prev &&
          prev.opts === state.opts &&
          prev.style === state.style &&
          prev.diff === state.diff &&
          prev.before === state.before &&
          prev.after === state.after &&
          prev.old === state.old &&
          prev.next === state.next &&
          prev.beforeName === state.beforeName &&
          prev.afterName === state.afterName

        if (same) {
          if (!instance) return
          instance.setLineAnnotations(notes)
          instance.rerender()
          return
        }

        instance?.cleanUp()
        const worker = getWorkerPool(state.style) as unknown as WorkerPoolManager | undefined
        instance = new FileDiff<T>(state.opts, worker)
        container.innerHTML = ""

        if (state.diff) {
          instance.render({
            fileDiff: state.diff,
            lineAnnotations: notes,
            containerWrapper: container,
          } as unknown as Parameters<FileDiff<T>["render"]>[0])
        }

        if (!state.diff && state.before && state.after) {
          instance.render({
            oldFile: { ...state.before, contents: state.old },
            newFile: { ...state.after, contents: state.next },
            lineAnnotations: notes,
            containerWrapper: container,
          } as unknown as Parameters<FileDiff<T>["render"]>[0])
        }

        scheme(container)
        untrack(() => local.onRendered?.())
      },
    ),
  )

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
  })

  return (
    <div
      data-component="file"
      data-mode="diff"
      style={styleVariables}
      class={local.class}
      classList={local.classList}
      ref={container}
    />
  )
}

export function Diff<T>(props: DiffProps<T>) {
  if (props.virtualized !== false) {
    const next = props as unknown as Record<string, unknown>
    return <VirtualFile {...next} mode="diff" />
  }

  return <EagerDiff {...props} />
}
