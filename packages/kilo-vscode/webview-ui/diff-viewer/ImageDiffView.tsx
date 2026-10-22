import { type Component, createEffect, createSignal, Show } from "solid-js"
import type { DiffImageSide, WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"

interface ImageDiffViewProps {
  diff: WorktreeFileDiff
}

interface ImagePaneProps {
  file: string
  label: string
  image: DiffImageSide
}

function size(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

const ImagePane: Component<ImagePaneProps> = (props) => {
  const { t } = useLanguage()
  const [failed, setFailed] = createSignal(false)

  createEffect(() => {
    props.image.data
    setFailed(false)
  })

  const message = () => {
    if (props.image.error === "too-large") {
      return t("agentManager.review.imageTooLarge", { size: size(props.image.bytes) })
    }
    if (props.image.error === "unreadable" || failed()) return t("agentManager.review.imageUnreadable")
    return undefined
  }

  return (
    <section class="am-image-diff-pane">
      <header class="am-image-diff-label">
        <span>{props.label}</span>
        <span>{size(props.image.bytes)}</span>
      </header>
      <div class="am-image-diff-canvas">
        <Show when={props.image.data && !message()} fallback={<span class="am-image-diff-message">{message()}</span>}>
          <img
            src={`data:${props.image.mime};base64,${props.image.data}`}
            alt={`${props.file} ${props.label.toLowerCase()}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
          />
        </Show>
      </div>
    </section>
  )
}

export const ImageDiffView: Component<ImageDiffViewProps> = (props) => {
  const { t } = useLanguage()
  const image = () => props.diff.image
  const available = () => Boolean(image()?.before || image()?.after)

  return (
    <Show
      when={available()}
      fallback={<div class="am-image-diff-unavailable">{t("agentManager.review.imageUnavailable")}</div>}
    >
      <div class="am-image-diff">
        <Show when={image()?.before}>
          {(side) => <ImagePane file={props.diff.file} label={t("agentManager.review.imageBefore")} image={side()} />}
        </Show>
        <Show when={image()?.after}>
          {(side) => <ImagePane file={props.diff.file} label={t("agentManager.review.imageAfter")} image={side()} />}
        </Show>
      </div>
    </Show>
  )
}
