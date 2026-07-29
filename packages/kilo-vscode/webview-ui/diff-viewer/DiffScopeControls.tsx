import { Show, type Component } from "solid-js"
import type { DiffSourceDescriptor } from "../../src/diff/sources/types"
import type { BranchInfo } from "../src/types/messages"
import { DiffPickerHeader } from "./DiffPickerHeader"
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
   * Compact mode for the narrow Agent Manager side panel: hides the
   * `current → base` prefix so only the picker trigger remains.
   */
  compact?: boolean
}

/**
 * Composes the scope selector and base branch picker into one control row.
 * Shared by the standalone Changes header and the two Agent Manager diff
 * surfaces so all three render the identical controls.
 */
export const DiffScopeControls: Component<DiffScopeControlsProps> = (props) => {
  return (
    <DiffPickerHeader
      descriptors={props.descriptors}
      currentId={props.currentId}
      onSelect={props.onSelectScope}
      accessory={
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
      }
    />
  )
}
