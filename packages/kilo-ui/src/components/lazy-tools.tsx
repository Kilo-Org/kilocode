import { lazy, Suspense, type ComponentProps } from "solid-js"
import type { ToolActionDiff } from "./message-part"
import type { normalize } from "./session-diff"

const RawNormalizedDiff = lazy(() =>
  import("./normalized-diff").then((mod) => ({ default: mod.NormalizedDiff })),
)
const RawChartTool = lazy(() => import("./chart").then((mod) => ({ default: mod.ChartTool })))

export const LazyNormalizedDiff = (props: ComponentProps<typeof RawNormalizedDiff>) => (
  <Suspense>
    <RawNormalizedDiff {...props} />
  </Suspense>
)

export const LazyChartTool = (props: ComponentProps<typeof RawChartTool>) => (
  <Suspense>
    <RawChartTool {...props} />
  </Suspense>
)

export function openFallbackDiff(
  fallback: Parameters<typeof normalize>[0],
  path: string,
  open: (diff: ToolActionDiff) => void,
) {
  void import("./session-diff")
    .then((mod) => {
      const value = mod.normalize(fallback)
      open({ file: path, patch: value.patch, additions: value.additions, deletions: value.deletions })
    })
    .catch(() => undefined)
}
