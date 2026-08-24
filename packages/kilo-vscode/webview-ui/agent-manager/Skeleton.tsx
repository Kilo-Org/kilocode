import { For, type Component } from "solid-js"

/** Staggered widths so stacked placeholder rows read as a list, not a striped block. */
const BRANCH = ["62%", "44%", "70%", "52%"]
const SUB = ["38%", "30%", "46%", "34%"]
const TITLE = ["70%", "55%", "65%", "48%"]

const rows = (count: number) => Array.from({ length: count }, (_, index) => index)

/** Offset each row's pulse so any row count keeps the wave effect. */
const delay = (index: number) => `${index * 0.12}s`

/** Placeholder worktree rows shown until a project's worktree list arrives. */
export const WorktreeSkeleton: Component<{ count?: number }> = (props) => (
  <div class="am-skeleton-list">
    <For each={rows(props.count ?? 3)}>
      {(index) => (
        <div class="am-skeleton-wt">
          <div class="am-skeleton-wt-icon" style={{ "animation-delay": delay(index) }} />
          <div class="am-skeleton-wt-lines">
            <div
              class="am-skeleton-wt-text"
              style={{ width: BRANCH[index % BRANCH.length], "animation-delay": delay(index) }}
            />
            <div
              class="am-skeleton-wt-sub"
              style={{ width: SUB[index % SUB.length], "animation-delay": delay(index) }}
            />
          </div>
        </div>
      )}
    </For>
  </div>
)

/** Placeholder session rows shown until a project's session list arrives. */
export const SessionSkeleton: Component<{ count?: number }> = (props) => (
  <div class="am-skeleton-list">
    <For each={rows(props.count ?? 3)}>
      {(index) => (
        <div class="am-skeleton-session">
          <div
            class="am-skeleton-session-title"
            style={{ width: TITLE[index % TITLE.length], "animation-delay": delay(index) }}
          />
          <div class="am-skeleton-session-time" style={{ "animation-delay": delay(index) }} />
        </div>
      )}
    </For>
  </div>
)

/** Placeholder for the two-line git stats column on a local or worktree row. */
export const StatsSkeleton: Component = () => (
  <div class="am-worktree-stats-skeleton">
    <div class="am-worktree-stats-skeleton-row" />
    <div class="am-worktree-stats-skeleton-row" style={{ width: "70%" }} />
  </div>
)
