import { For, Show, createEffect, on, onCleanup, onMount, type Accessor, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { ActivityIcon } from "../../src/components/shared/ActivityIcon"
import { label } from "../../src/utils/session-activity"
import { useLanguage } from "../../src/context/language"
import { ProjectsSection } from "../ProjectsSection"
import { ProjectSidebarBody } from "../ProjectSidebarBody"
import { createProjectStore } from "../project/store"
import { buildProjectNavEntries } from "../project-nav"
import { buildShortcutMap } from "../section-helpers"
import type { WorktreeDelete } from "../worktree-delete"
import { examples, type Example } from "./examples"
import { fleet } from "./fleet"
import { frame } from "./frame"
import { createMarkers } from "./markers"

const noop = () => undefined
const deletion: WorktreeDelete = { pending: noop, cancel: noop, confirm: noop, select: noop }

/** The live project sidebar, fed with an example's fixture. */
function Fleet(props: { example: Example; marker: (id: string) => JSX.Element | undefined }) {
  const { t } = useLanguage()
  const rows = fleet(props.example).map((row) => {
    const store = createProjectStore(row.project.id)
    store.applyState(row.state)
    return { ...row, store }
  })
  const projects = rows.map((row) => row.project)
  const states = Object.fromEntries(rows.map((row) => [row.project.id, row.state]))
  const shortcuts = buildShortcutMap(buildProjectNavEntries(projects, states))
  return (
    <ProjectsSection
      projects={projects}
      t={t}
      bindings={{}}
      tools={<Icon name="magnifying-glass" size="small" />}
      onAdd={noop}
      onCreateProject={noop}
      onClone={noop}
      onSelect={noop}
      onRemove={noop}
      onExpand={noop}
      onReorder={noop}
      onHistory={noop}
      onNew={noop}
      onCreate={noop}
      onSection={noop}
      onSettings={noop}
      count={(id) => states[id]!.worktrees.length + 1}
      baseBranch={(id) => rows.find((row) => row.project.id === id)?.local.branch ?? "main"}
      marker={props.marker}
      body={(project) => {
        const row = rows.find((item) => item.project.id === project.id)!
        return (
          <ProjectSidebarBody
            project={project}
            state={row.state}
            store={row.store}
            deletion={deletion}
            busy={() => false}
            blocked={() => false}
            activityFor={(id) => (id === null ? "idle" : (row.activity[id] ?? "idle"))}
            stats={row.stats}
            local={row.local}
            prs={row.prs}
            selectedProject={row.selection ? project.id : undefined}
            selection={row.selection}
            bindings={{}}
            t={t}
            onSelectLocal={noop}
            onSelectWorktree={noop}
            onOpenComments={noop}
            onOpenPR={noop}
            onCreateSection={noop}
            renamingSection={noop}
            onRenameEnd={noop}
            shortcutMap={() => shortcuts}
            marker={props.marker}
          />
        )
      }}
    />
  )
}

function Legend() {
  const { t } = useLanguage()
  return (
    <div class="am-splash-legend" aria-hidden="true">
      <For each={["busy", "done", "waiting"] as const}>
        {(state) => (
          <span>
            <span class="am-wt-icon" data-activity={state}>
              <ActivityIcon state={state} />
            </span>
            {t(label(state))}
          </span>
        )}
      </For>
    </div>
  )
}

/** A decorative, inert copy of the real sidebar with each feature's row badged. */
export function Preview(props: { selected: Accessor<number>; hover: Accessor<number | undefined> }) {
  const { t } = useLanguage()
  const example = () => examples.at(props.selected())!
  let card!: HTMLDivElement
  const reframe = () => {
    const list = card.querySelector<HTMLElement>(".am-projects-list")
    // When the badged rows do not all fit, keep the topmost one in view.
    const active = list?.querySelector(".am-splash-row-marker")
    if (!list || !active) return
    const current = list.scrollTop
    // Measure from the top, where no sticky project header is stuck, so boxes are layout positions.
    list.scrollTop = 0
    const origin = list.getBoundingClientRect().top
    const box = (badge: Element) => {
      const rect = badge.closest(".am-worktree-item, .am-sidebar-header, .am-wt-group-header")!.getBoundingClientRect()
      return { top: rect.top - origin, bottom: rect.bottom - origin }
    }
    const boxes = [...list.querySelectorAll(".am-splash-row-marker")].map(box)
    list.scrollTop = frame({
      top: Math.min(...boxes.map((item) => item.top)),
      bottom: Math.max(...boxes.map((item) => item.bottom)),
      active: box(active),
      height: list.clientHeight,
      fade: parseFloat(getComputedStyle(list).getPropertyValue("--am-splash-fade")),
      header: list.querySelector(".am-project-item")?.getBoundingClientRect().height ?? 0,
      current,
    })
  }
  createEffect(on(props.selected, reframe))
  onMount(() => {
    // Container queries change the card's height with the layout mode.
    const observer = new ResizeObserver(reframe)
    observer.observe(card)
    onCleanup(() => observer.disconnect())
  })
  return (
    <div class="am-splash-preview" data-tone={example().id}>
      <div ref={card} class="am-splash-preview-card" role="figure" aria-label={t("agentManager.splash.preview.label")}>
        <Show when={example()} keyed>
          {(item) => (
            <div class="am-splash-preview-fleet" inert aria-hidden="true">
              <Fleet example={item} marker={createMarkers(item, props.hover)} />
            </div>
          )}
        </Show>
      </div>
      <Legend />
    </div>
  )
}
