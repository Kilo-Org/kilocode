import type { Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { GeneratedSummary } from "../src/types/messages"

/** Shared footer showing aggregate stats for generated/vendor files excluded from diffs. */
export const GeneratedSummaryFooter: Component<{ generated: GeneratedSummary }> = (props) => (
  <div class="am-diff-generated-summary">
    <div class="am-diff-generated-header">
      <Icon name="archive" size="small" />
      <span>
        {props.generated.files} generated {props.generated.files === 1 ? "file" : "files"} hidden
      </span>
      <span class="am-diff-header-adds">+{props.generated.additions}</span>
      <span class="am-diff-header-dels">-{props.generated.deletions}</span>
    </div>
  </div>
)
