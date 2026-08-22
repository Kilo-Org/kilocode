import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { For, Show, type Accessor, type Component } from "solid-js"
import { VirtualDiffView } from "../diff-viewer/VirtualDiffView"
import { useLanguage } from "../src/context/language"
import type { EditPreview } from "./edit-preview"

interface Props {
  state: {
    preview: Accessor<EditPreview | undefined>
    updateStyle: (style: "unified" | "split") => void
    updateMarkdown: (render: boolean) => void
    close: () => void
  }
  visible: Accessor<boolean>
}

export const EditPreviewPanel: Component<Props> = (props) => {
  const { t } = useLanguage()

  return (
    <section
      class="am-edit-preview-panel"
      classList={{ "am-edit-preview-panel-visible": props.visible() }}
      aria-label={t("agentManager.editPreview.title")}
      aria-hidden={!props.visible()}
      inert={!props.visible()}
    >
      <header class="am-edit-preview-header">
        <div class="am-edit-preview-heading">
          <Icon name="edit" size="small" />
          <span>{t("agentManager.editPreview.title")}</span>
        </div>
        <Show when={props.state.preview()}>
          {(preview) => (
            <RadioGroup
              options={["unified", "split"] as const}
              current={preview().style}
              value={(style) => style}
              label={(style) =>
                style === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
              }
              size="small"
              onSelect={(style) => {
                if (style) props.state.updateStyle(style)
              }}
            />
          )}
        </Show>
        <IconButton
          icon="close"
          size="small"
          variant="ghost"
          class="am-edit-preview-close"
          type="button"
          label={t("agentManager.editPreview.close")}
          onClick={props.state.close}
        />
      </header>
      <Show when={props.state.preview()}>
        {(preview) => (
          <div class="am-edit-preview-files">
            <For each={preview().diff.files ?? [preview().diff]}>
              {(diff) => (
                <VirtualDiffView
                  diff={diff}
                  diffStyle={preview().style}
                  onDiffStyleChange={props.state.updateStyle}
                  markdownRender={preview().markdown}
                  onMarkdownRenderChange={props.state.updateMarkdown}
                  styleSelect={false}
                />
              )}
            </For>
          </div>
        )}
      </Show>
    </section>
  )
}
