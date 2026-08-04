import { Show, type Component } from "solid-js"
import type { DiffSourceDescriptor } from "../../src/diff/sources/types"
import type { BranchInfo } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { InlineSelect, type InlineOption } from "./InlineSelect"
import { BaseBranchPicker } from "./BaseBranchPicker"

interface DiffScopeControlsProps {
  descriptors: DiffSourceDescriptor[]
  currentId: string | undefined
  onSelectScope: (id: string) => void
  /** Show the base branch picker (only when the Branch scope is active). */
  showBase: boolean
  branches: BranchInfo[]
  branchesLoading: boolean
  defaultBranch: string
  autoBase: string | undefined
  currentBase: string | undefined
  isAuto: boolean
  currentBranch: string | undefined
  onSelectBase: (branch: string | undefined) => void
  /**
   * Compact mode for the narrow side panel: drops the `current →` prefix and
   * tightens the label caps so the row survives a user-shrunk panel.
   */
  compact?: boolean
}

/**
 * Scope selector plus base branch picker, sized to sit inline in a diff
 * toolbar row. Shared by the Agent Manager side panel and review tab.
 *
 * Note this deliberately avoids `DiffPickerHeader`: that component is a
 * full-width header band (`margin: 8px 12px`) and using it inside a toolbar
 * inflates the row height and misaligns against the neighboring buttons.
 */
export const DiffScopeControls: Component<DiffScopeControlsProps> = (props) => {
  const { t } = useLanguage()

  const options = (): InlineOption<string>[] =>
    props.descriptors.map((desc) => ({
      value: desc.id,
      label: t(`diffViewer.source.${desc.type}.label`),
      group: t(desc.group === "Session" ? "diffViewer.group.session" : "diffViewer.group.git"),
    }))

  // The trigger's tooltip explains what the active scope actually shows,
  // reusing the per-scope descriptions the standalone picker already has.
  const title = () => {
    const active = props.descriptors.find((desc) => desc.id === props.currentId)
    if (!active) return ""
    return t(`diffViewer.source.${active.type}.tooltip`)
  }

  return (
    <span class="diff-scope-controls" classList={{ "diff-scope-controls-compact": props.compact }}>
      <Show when={props.descriptors.length > 0}>
        <InlineSelect
          options={options()}
          value={props.currentId}
          onSelect={props.onSelectScope}
          title={title()}
          compact={props.compact}
        />
      </Show>
      <Show when={props.showBase}>
        <BaseBranchPicker
          branches={props.branches}
          loading={props.branchesLoading}
          defaultBranch={props.defaultBranch}
          autoBase={props.autoBase}
          currentBase={props.currentBase}
          isAuto={props.isAuto}
          currentBranch={props.compact ? undefined : props.currentBranch}
          onSelect={props.onSelectBase}
        />
      </Show>
    </span>
  )
}
