import { DIFFS_TAG_NAME, FileDiff, processFile, type SelectedLineRange, VirtualizedFileDiff } from "@pierre/diffs"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createEffect, onCleanup, onMount, Show, splitProps } from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import { createDefaultOptions, styleVariables, type DiffProps } from "../pierre"
import { acquireVirtualizer, virtualMetrics } from "@opencode-ai/ui/pierre/virtualizer"
import { useWorkerPool } from "@opencode-ai/ui/context/worker-pool"
import { applyDiffCommentedLines, diffRowIndex } from "../pierre/diff-dom"
import { fixDiffSelection } from "../pierre/selection-range"

export type SSRDiffProps<T = {}> = DiffProps<T> & {
  preloadedDiff: PreloadMultiFileDiffResult<T>
}

export function Diff<T>(props: SSRDiffProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  const [local, others] = splitProps(props, [
    "before",
    "after",
    "patch",
    "fileDiff",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "virtualized",
    "sizeKey",
  ])
  const workerPool = useWorkerPool(props.diffStyle)

  let fileDiffInstance: FileDiff<T> | undefined
  let sharedVirtualizer: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined
  const cleanupFunctions: Array<() => void> = []

  const getRoot = () => fileDiffRef?.shadowRoot ?? undefined

  const getVirtualizer = () => {
    if (sharedVirtualizer) return sharedVirtualizer.virtualizer

    const result = acquireVirtualizer(container)
    if (!result) return

    sharedVirtualizer = result
    return result.virtualizer
  }

  const applyScheme = () => {
    const scheme = document.documentElement.dataset.colorScheme
    if (scheme === "dark" || scheme === "light") {
      fileDiffRef.dataset.colorScheme = scheme
      return
    }

    fileDiffRef.removeAttribute("data-color-scheme")
  }

  const fixSelection = (range: SelectedLineRange | null) => {
    const root = getRoot()
    if (!root) return
    return fixDiffSelection(root, range, diffRowIndex)
  }

  const setSelectedLines = (range: SelectedLineRange | null, attempt = 0) => {
    const diff = fileDiffInstance
    if (!diff) return

    const fixed = fixSelection(range)
    if (fixed === undefined) {
      if (attempt >= 120) return
      requestAnimationFrame(() => setSelectedLines(range, attempt + 1))
      return
    }

    diff.setSelectedLines(fixed)
  }

  onMount(() => {
    if (isServer || !props.preloadedDiff) return

    applyScheme()

    if (typeof MutationObserver !== "undefined") {
      const root = document.documentElement
      const monitor = new MutationObserver(() => applyScheme())
      monitor.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] })
      onCleanup(() => monitor.disconnect())
    }

    const virtualizer = local.virtualized === false ? undefined : getVirtualizer()

    fileDiffInstance = virtualizer
      ? new VirtualizedFileDiff<T>(
          {
            ...createDefaultOptions(props.diffStyle),
            ...others,
            ...props.preloadedDiff,
          },
          virtualizer,
          virtualMetrics,
          workerPool,
        )
      : new FileDiff<T>(
          {
            ...createDefaultOptions(props.diffStyle),
            ...others,
            ...props.preloadedDiff,
          },
          workerPool,
        )
    // @ts-expect-error - fileContainer is private but needed for SSR hydration
    fileDiffInstance.fileContainer = fileDiffRef
    const patch = "patch" in local && typeof local.patch === "string" ? local.patch : ""
    const metadata = local.fileDiff ?? (patch ? processFile(patch, { cacheKey: patch }) : undefined)
    fileDiffInstance.hydrate({
      oldFile: metadata ? undefined : local.before,
      newFile: metadata ? undefined : local.after,
      fileDiff: metadata,
      lineAnnotations: local.annotations,
      fileContainer: fileDiffRef,
      containerWrapper: container,
    })

    setSelectedLines(local.selectedLines ?? null)

    createEffect(() => {
      fileDiffInstance?.setLineAnnotations(local.annotations ?? [])
    })

    createEffect(() => {
      setSelectedLines(local.selectedLines ?? null)
    })

    createEffect(() => {
      const ranges = local.commentedLines ?? []
      const root = getRoot()
      if (root) requestAnimationFrame(() => applyDiffCommentedLines(root, ranges))
    })

    // Hydrate annotation slots with interactive SolidJS components
    // if (props.annotations.length > 0 && props.renderAnnotation != null) {
    //   for (const annotation of props.annotations) {
    //     const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
    //     const slotElement = fileDiffRef.querySelector(
    //       `[slot="${slotName}"]`
    //     ) as HTMLElement;
    //
    //     if (slotElement != null) {
    //       // Clear the static server-rendered content from the slot
    //       slotElement.innerHTML = '';
    //
    //       // Mount a fresh SolidJS component into this slot using render().
    //       // This enables full SolidJS reactivity (signals, effects, etc.)
    //       const dispose = render(
    //         () => props.renderAnnotation!(annotation),
    //         slotElement
    //       );
    //       cleanupFunctions.push(dispose);
    //     }
    //   }
    // }
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiffInstance?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
    sharedVirtualizer?.release()
    sharedVirtualizer = undefined
  })

  return (
    <div data-component="diff" style={styleVariables} ref={container}>
      <Dynamic component={DIFFS_TAG_NAME} ref={fileDiffRef} id="ssr-diff">
        <Show when={isServer}>
          <template shadowrootmode="open" innerHTML={props.preloadedDiff.prerenderedHTML} />
        </Show>
      </Dynamic>
    </div>
  )
}
