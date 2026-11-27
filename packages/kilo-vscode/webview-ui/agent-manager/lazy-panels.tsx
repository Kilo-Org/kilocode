import { lazy, Suspense, type ComponentProps } from "solid-js"

// Heavy, cleanly-isolated diff/PR/document subtrees loaded lazily so initial Agent Manager startup
// never parses `@pierre/diffs`, PR review UI, or document rendering before those panels open.
const RawDiffPanelCache = lazy(() => import("./DiffPanelCache").then((mod) => ({ default: mod.DiffPanelCache })))
const RawPRPanelHost = lazy(() => import("./pr/PRPanelHost").then((mod) => ({ default: mod.PRPanelHost })))
const RawFullScreenDiffView = lazy(() =>
  import("../diff-viewer/FullScreenDiffView").then((mod) => ({ default: mod.FullScreenDiffView })),
)
const RawDocumentPanelHost = lazy(() =>
  import("./documents/DocumentPanelHost").then((mod) => ({ default: mod.DocumentPanelHost })),
)
const RawEditPreviewPanel = lazy(() =>
  import("./EditPreviewPanel").then((mod) => ({ default: mod.EditPreviewPanel })),
)

export const DiffPanelCache = (props: ComponentProps<typeof RawDiffPanelCache>) => (
  <Suspense>
    <RawDiffPanelCache {...props} />
  </Suspense>
)
export const PRPanelHost = (props: ComponentProps<typeof RawPRPanelHost>) => (
  <Suspense>
    <RawPRPanelHost {...props} />
  </Suspense>
)
export const FullScreenDiffView = (props: ComponentProps<typeof RawFullScreenDiffView>) => (
  <Suspense>
    <RawFullScreenDiffView {...props} />
  </Suspense>
)
export const DocumentPanelHost = (props: ComponentProps<typeof RawDocumentPanelHost>) => (
  <Suspense>
    <RawDocumentPanelHost {...props} />
  </Suspense>
)
export const EditPreviewPanel = (props: ComponentProps<typeof RawEditPreviewPanel>) => (
  <Suspense>
    <RawEditPreviewPanel {...props} />
  </Suspense>
)
