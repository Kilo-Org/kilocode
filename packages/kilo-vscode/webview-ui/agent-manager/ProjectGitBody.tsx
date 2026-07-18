/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import type { LocalGitStats, WorktreeGitStats } from "../src/types/messages"
import { projectPRNumber, type ProjectGitView } from "./project-git-view"

export type { ProjectGitView } from "./project-git-view"

const Stats: Component<{ value?: LocalGitStats | WorktreeGitStats }> = (props) => (
  <Show when={props.value}>
    {(value) => (
      <div class="am-worktree-stats">
        <div class="am-worktree-stats-row">
          <Show when={value().files > 0}>
            <span class="am-stat-files">{value().files}f</span>
          </Show>
          <Show when={value().additions > 0}>
            <span class="am-stat-additions">+{value().additions}</span>
          </Show>
          <Show when={value().deletions > 0}>
            <span class="am-stat-deletions">−{value().deletions}</span>
          </Show>
        </div>
        <Show when={value().ahead > 0 || value().behind > 0}>
          <div class="am-worktree-stats-row">
            <Show when={value().ahead > 0}>
              <span class="am-worktree-commits">↑{value().ahead}</span>
            </Show>
            <Show when={value().behind > 0}>
              <span class="am-worktree-behind">↓{value().behind}</span>
            </Show>
          </div>
        </Show>
      </div>
    )}
  </Show>
)

export interface ProjectGitLabels {
  local: string
  worktrees: string
  loading: string
  notGit: string
}

export const ProjectGitBody: Component<{ value?: ProjectGitView; labels: ProjectGitLabels }> = (props) => {
  const state = () => props.value?.state
  return (
    <Show when={state()} fallback={<div class="am-project-empty">{props.labels.loading}</div>}>
      {(value) => (
        <>
          <div class="am-local-item">
            <div class="am-local-text">
              <span class="am-local-label">{props.labels.local}</span>
              <Show when={value().branch}>
                <span class="am-local-branch">{value().branch}</span>
              </Show>
            </div>
            <Stats value={props.value?.local} />
          </div>
          <div class="am-section">
            <div class="am-section-header">
              <span class="am-section-label">{props.labels.worktrees}</span>
            </div>
            <div class="am-worktree-list">
              <Show
                when={value().isGitRepo !== false}
                fallback={<div class="am-not-git-notice">{props.labels.notGit}</div>}
              >
                <For each={value().worktrees}>
                  {(worktree) => {
                    const number = () => projectPRNumber(props.value, worktree)
                    return (
                      <div class="am-local-item">
                        <div class="am-local-text">
                          <span class="am-local-label">{worktree.label ?? worktree.branch}</span>
                          <Show when={number()}>{(value) => <span class="am-local-branch">PR #{value()}</span>}</Show>
                        </div>
                        <Stats value={props.value?.stats[worktree.id]} />
                      </div>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </>
      )}
    </Show>
  )
}
