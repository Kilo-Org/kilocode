import { For, type Accessor, type JSX } from "solid-js"
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
  return (
    <div class="am-splash-preview" data-tone={example().id}>
      <div class="am-splash-preview-card" role="figure" aria-label={t("agentManager.splash.preview.label")}>
        <For each={examples}>
          {(item) => (
            <div
              class="am-splash-preview-fleet"
              classList={{ "am-splash-preview-fleet-active": item === example() }}
              inert
              aria-hidden="true"
            >
              <Fleet example={item} marker={createMarkers(item, props.hover)} />
            </div>
          )}
        </For>
      </div>
      <Legend />
    </div>
  )
}
