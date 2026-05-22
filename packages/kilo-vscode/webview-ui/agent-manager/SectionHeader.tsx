import { Component, Show, createEffect, createSignal, type JSX } from "solid-js"
import { createDroppable } from "@thisbeyond/solid-dnd"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { SectionState } from "../src/types/messages"
import { SECTION_COLORS, colorCss } from "./section-colors"
import { useLanguage } from "../src/context/language"

interface Props {
  section: SectionState
  count: number
  children?: JSX.Element
  /** When true, auto-enter rename mode (e.g. after creation). */
  autoRename?: boolean
  onToggle: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onSetColor: (color: string | null) => void
  /** Called when rename ends (commit or cancel) so parent clears autoRename. */
  onRenameEnd?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  isFirst?: boolean
  isLast?: boolean
}

const SectionHeader: Component<Props> = (props) => {
  const { t } = useLanguage()
  const [renaming, setRenaming] = createSignal(false)
  const [value, setValue] = createSignal("")

  const border = () => colorCss(props.section.color) ?? "var(--vscode-panel-border)"

  const startRename = () => {
    setValue(props.section.name)
    setRenaming(true)
  }

  const commit = () => {
    const trimmed = value().trim()
    setRenaming(false)
    props.onRenameEnd?.()
    if (trimmed && trimmed !== props.section.name) {
      props.onRename(trimmed)
    }
  }

  const cancel = () => {
    setRenaming(false)
    props.onRenameEnd?.()
  }

  createEffect(() => {
    if (props.autoRename && !renaming()) startRename()
  })

  const handleClick = (e: MouseEvent) => {
    if (e.button !== 0 || renaming()) return
    props.onToggle()
  }

  const droppable = createDroppable(props.section.id)

  return (
    <div
      ref={droppable.ref}
      class={`am-section-group ${droppable.isActiveDroppable ? "am-section-group-drop" : ""}`}
      style={{ "--section-color": border() }}
    >
      <ContextMenu>
        <ContextMenu.Trigger class="am-section-group-header" onClick={handleClick}>
          <div class="am-section-group-left">
            <Icon
              name="chevron-down"
              size="small"
              class={`am-section-group-chevron ${props.section.collapsed ? "am-section-group-chevron-collapsed" : ""}`}
            />
            <Show
              when={!renaming()}
              fallback={
                <input
                  class="am-section-group-rename"
                  value={value()}
                  onInput={(e) => setValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit()
                    if (e.key === "Escape") cancel()
                  }}
                  onBlur={commit}
                  onClick={(e) => e.stopPropagation()}
                  ref={(el) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => {
                        el.focus()
                        el.select()
                      }),
                    )
                  }
                />
              }
            >
              <span class="am-section-group-name">{props.section.name}</span>
            </Show>
          </div>
          <span class="am-section-group-count">{props.count}</span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="am-ctx-menu">
            <ContextMenu.Item onSelect={startRename}>
              <Icon name="edit" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.section.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Group>
              <ContextMenu.GroupLabel>{t("agentManager.section.setColor")}</ContextMenu.GroupLabel>
              <div class="am-color-grid">
                <ContextMenu.Item onSelect={() => props.onSetColor(null)} class="am-color-grid-item">
                  <span class="am-color-swatch am-color-swatch-default"></span>
                </ContextMenu.Item>
                {SECTION_COLORS.map((c) => (
                  <ContextMenu.Item onSelect={() => props.onSetColor(c.label)} class="am-color-grid-item">
                    <span
                      class={`am-color-swatch ${props.section.color === c.label ? "am-color-swatch-active" : ""}`}
                      style={{ background: c.css }}
                    ></span>
                  </ContextMenu.Item>
                ))}
              </div>
            </ContextMenu.Group>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => props.onMoveUp?.()} disabled={props.isFirst}>
              <Icon name="arrow-up" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.section.moveUp")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => props.onMoveDown?.()} disabled={props.isLast}>
              <Icon name="arrow-up" size="small" class="am-icon-flip" />
              <ContextMenu.ItemLabel>{t("agentManager.section.moveDown")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={props.onDelete} class="am-ctx-menu-danger">
              <Icon name="trash" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.section.delete")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
      {props.children}
    </div>
  )
}

export default SectionHeader
