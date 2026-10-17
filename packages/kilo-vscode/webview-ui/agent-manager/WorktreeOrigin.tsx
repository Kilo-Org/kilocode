// Starting point of a new worktree: project and base branch in one control.

/** @jsxImportSource solid-js */

import { Show, createMemo, createSignal, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { DeferredPopover } from "../src/components/shared/DeferredPopover"
import { BRANCH_LIMIT, BranchSelect, BranchSelectPopover } from "../src/components/shared/BranchSelect"
import { useLanguage } from "../src/context/language"
import type { AgentProjectSnapshot, BranchInfo } from "../src/types/messages"
import { ProjectSelect } from "./ProjectSelect"

interface Props {
  projects: AgentProjectSnapshot[]
  project?: string
  onProject: (id: string) => void
  /** Project picker state, controlled so the `/project` command can open it. */
  projectOpen: boolean
  onProjectOpen: (open: boolean) => void
  /** Base branch picker, hidden on the Import tab. */
  branch: boolean
  branches: BranchInfo[]
  loading: boolean
  /** Branch the worktree starts from. */
  base: string
  /** Project default base branch. */
  fallback: string
  onBase: (name: string) => void
  onDefault: (name: string) => void
  disabled?: boolean
}

export const WorktreeOrigin: Component<Props> = (props) => {
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [highlight, setHighlight] = createSignal(0)

  const label = () => props.projects.find((item) => item.id === props.project)?.label ?? ""
  const custom = () => props.base !== props.fallback
  // Default and current pick come first, so they stay visible above the row cap.
  const ordered = createMemo(() => {
    const top = [props.fallback, props.base]
    const rank = (b: BranchInfo) => {
      const index = top.indexOf(b.name)
      return index === -1 ? top.length : index
    }
    return props.branches.toSorted((a, b) => rank(a) - rank(b))
  })
  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return ordered()
    return ordered().filter((b) => b.name.toLowerCase().includes(query))
  })

  const close = () => {
    setOpen(false)
    setSearch("")
    setHighlight(0)
  }

  const choose = (name: string) => {
    props.onBase(name)
    close()
  }

  const reveal = (index: number) =>
    requestAnimationFrame(() =>
      document.querySelector(`.am-nv-origin-dropdown .am-branch-item[data-index="${index}"]`)?.scrollIntoView({
        block: "nearest",
      }),
    )

  const keydown = (e: KeyboardEvent) => {
    const max = Math.min(filtered().length, BRANCH_LIMIT) - 1
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      const next = e.key === "ArrowDown" ? Math.min(highlight() + 1, max) : Math.max(highlight() - 1, 0)
      setHighlight(next)
      reveal(next)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      const item = filtered()[highlight()]
      if (item) choose(item.name)
      return
    }
    if (e.key !== "Escape") return
    e.preventDefault()
    e.stopPropagation()
    close()
  }

  return (
    <div class="am-nv-origin">
      <Show when={props.projects.length > 0}>
        <DeferredPopover
          open={props.projectOpen}
          onOpenChange={props.onProjectOpen}
          placement="bottom-start"
          flip={false}
          portal={false}
          deferDismiss
          class="am-dropdown am-nv-origin-projects"
          trigger={
            <button
              class="am-nv-origin-segment am-nv-origin-project"
              type="button"
              aria-label={t("agentManager.dialog.project.select")}
              title={label()}
              disabled={props.disabled}
            >
              <Icon name="folder" size="small" />
              <Show
                when={label()}
                fallback={<span class="am-nv-origin-placeholder">{t("agentManager.dialog.project.select")}</span>}
              >
                <span class="am-nv-origin-value">{label()}</span>
              </Show>
              <Icon name="selector" size="small" />
            </button>
          }
        >
          <ProjectSelect
            projects={props.projects}
            selected={props.project}
            onSelect={(id) => {
              props.onProject(id)
              props.onProjectOpen(false)
            }}
            labels={{ missing: t("agentManager.dialog.project.missing") }}
          />
        </DeferredPopover>
      </Show>
      <Show when={props.branch}>
        <Show when={props.projects.length > 0}>
          <span class="am-nv-origin-divider" aria-hidden="true" />
        </Show>
        <BranchSelectPopover
          open={open()}
          onOpenChange={(value) => {
            if (!value) return close()
            setHighlight(
              Math.max(
                0,
                filtered().findIndex((b) => b.name === props.base),
              ),
            )
            setOpen(true)
          }}
          placement="bottom-end"
          sameWidth={false}
          class="am-nv-origin-dropdown"
          trigger={
            <button
              class="am-nv-origin-segment am-nv-origin-branch"
              type="button"
              aria-label={t("agentManager.dialog.baseBranch")}
              title={props.base}
              disabled={props.disabled}
            >
              <Icon name="branch" size="small" />
              <span class="am-nv-origin-value am-nv-origin-mono">{props.base}</span>
              <Show when={!custom()}>
                <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
              </Show>
              <Icon name="selector" size="small" />
            </button>
          }
        >
          <BranchSelect
            branches={filtered()}
            loading={props.loading}
            search={search()}
            onSearch={(value) => {
              setSearch(value)
              setHighlight(0)
            }}
            onSelect={(b) => choose(b.name)}
            onSearchKeyDown={keydown}
            selected={props.base}
            highlighted={highlight()}
            onHighlight={setHighlight}
            defaultName={props.fallback}
            searchPlaceholder={t("agentManager.dialog.searchBranches")}
            loadingLabel={t("agentManager.import.loadingBranches")}
            emptyLabel={t("agentManager.import.noMatchingBranches")}
            defaultLabel={t("agentManager.dialog.branchBadge.default")}
            remoteLabel={t("agentManager.dialog.branchBadge.remote")}
            footer={
              <>
                <span class="am-nv-origin-default" title={props.fallback}>
                  {t("agentManager.dialog.defaultBase", { branch: props.fallback })}
                </span>
                <Show when={custom()}>
                  <button class="am-nv-origin-set-default" type="button" onClick={() => props.onDefault(props.base)}>
                    {t("agentManager.dialog.setDefaultBase")}
                  </button>
                </Show>
              </>
            }
          />
        </BranchSelectPopover>
      </Show>
    </div>
  )
}
