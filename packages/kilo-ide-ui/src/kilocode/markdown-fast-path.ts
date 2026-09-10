// Fast-path initial render for completed (non-streaming) markdown blocks.
// Skips morphdom's expensive tree-matching by writing innerHTML directly
// when the container is empty. On large session switches this avoids the
// dominant "Parse HTML + morphdom diff" cost for historical messages.

type CopyLabels = { copy: string; copied: string }

/**
 * If the content is a first paint of completed markdown (not streaming,
 * container empty), render directly via innerHTML and return true.
 * The caller should skip morphdom when this returns true.
 */
export function tryFastRender(
  container: HTMLDivElement,
  content: string,
  streaming: boolean | undefined,
  decorate: (root: HTMLDivElement, labels: CopyLabels) => void,
  setupCopy: (root: HTMLDivElement, getLabels: () => CopyLabels) => (() => void) | undefined,
  getLabels: () => CopyLabels,
  copyCleanup: (() => void) | undefined,
): { handled: boolean; copyCleanup: (() => void) | undefined } {
  if (streaming || container.childNodes.length > 0) {
    return { handled: false, copyCleanup }
  }
  container.innerHTML = content
  decorate(container, getLabels())
  const cleanup = copyCleanup ?? setupCopy(container, getLabels)
  return { handled: true, copyCleanup: cleanup }
}
