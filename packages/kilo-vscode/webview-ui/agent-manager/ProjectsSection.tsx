/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, createDraggable, type DragEvent } from "@thisbeyond/solid-dnd"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { LanguageContextValue } from "../src/context/language"
import type { AgentProjectSnapshot } from "../src/types/messages"
import { ProjectsFooter } from "./ProjectsFooter"
import { SidebarSectionHeader } from "./SidebarSectionHeader"
import { ProjectRowActions } from "./ProjectRowActions"
import { ProjectAvatar } from "./ProjectAvatar"
import { ConstrainDragXAxis } from "./constrain-drag-x"
import { applyProjectOrder, moveProject, projectDrop, type ProjectDrop } from "./project-order"

interface ProjectsSectionProps {
  projects: AgentProjectSnapshot[]
  t: LanguageContextValue["t"]
  bindings: Record<string, string>
  onAdd: () => void
  onCreateProject: () => void
  onClone: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onExpand: (id: string, expanded: boolean) => void
  onReorder: (order: string[]) => void
  onHistory: (id: string) => void
  onNew: (id: string) => void
  onCreate: (id: string) => void
  onSection: (id: string) => void
  onSettings: (id: string) => void
  count: (id: string) => number | undefined
  baseBranch: (id: string) => string
  tools?: JSX.Element
  body: (project: AgentProjectSnapshot) => JSX.Element
}

const ProjectBodySlot: Component<{
  project: Accessor<AgentProjectSnapshot>
  body: (project: AgentProjectSnapshot) => JSX.Element
}> = (props) => untrack(() => props.body(props.project()))

/**
 * Stable project accordion. Every expanded project renders the same real body;
 * active state only controls detail-pane emphasis. Additional projects can be
 * reordered by dragging their header. The pinned workspace project stays first.
 */
export const ProjectsSection: Component<ProjectsSectionProps> = (props) => {
  // Optimistic order after a drop, until the extension pushes new snapshots.
  const [local, setLocal] = createSignal<string[]>()
  const [dragging, setDragging] = createSignal<string>()
  const [drop, setDrop] = createSignal<ProjectDrop>()
  const nodes = new Map<string, HTMLDivElement>()
  let list: HTMLDivElement | undefined
  const projects = createMemo(() => applyProjectOrder(props.projects, local()))
  const movable = createMemo(() =>
    projects()
      .filter((project) => !project.pinned)
      .map((project) => project.id),
  )

  createEffect(
    on(
      () => props.projects,
      () => setLocal(undefined),
      { defer: true },
    ),
  )

  const finish = () => {
    setDragging(undefined)
    setDrop(undefined)
    document.body.classList.remove("am-project-dragging-active")
  }
  onCleanup(finish)

  const onDragStart = (event: DragEvent) => {
    setDragging(String(event.draggable.id))
    document.body.classList.add("am-project-dragging-active")
  }

  const onDragMove = (event: DragEvent) => {
    // With an overlay, solid-dnd reports a zero transform for the draggable, so read the overlay.
    const center = (event.overlay ?? event.draggable).transformed.center
    // A release outside the sidebar cancels the move.
    if (list && center.x > list.getBoundingClientRect().right) {
      setDrop(undefined)
      return
    }
    const from = String(event.draggable.id)
    const y = center.y
    const rows = movable().flatMap((id) => {
      const rect = nodes.get(id)?.getBoundingClientRect()
      return rect ? [{ id, top: rect.top, bottom: rect.bottom }] : []
    })
    const next = projectDrop(rows, y)
    setDrop(next && moveProject(movable(), from, next) ? next : undefined)
  }

  const onDragEnd = (event: DragEvent) => {
    const target = drop()
    finish()
    if (!target) return
    const order = moveProject(movable(), String(event.draggable.id), target)
    if (!order) return
    setLocal(order)
    props.onReorder(order)
  }

  return (
    <div class="am-projects">
      <SidebarSectionHeader
        class="am-section-header"
        label={<span class="am-section-label">{props.t("agentManager.projects")}</span>}
        actions={props.tools}
      />
      <DragDropProvider onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}>
        <DragDropSensors />
        <ConstrainDragXAxis />
        <div ref={list} class="am-projects-list">
          <For each={projects().map((project) => project.id)}>
            {(id) => {
              const project = () => projects().find((item) => item.id === id)!
              // The pinned workspace project is not part of the stored catalog order.
              const draggable = untrack(project).pinned ? undefined : createDraggable(id)
              onCleanup(() => nodes.delete(id))
              return (
                <div
                  ref={(el) => nodes.set(id, el)}
                  class="am-project"
                  classList={{
                    "am-project-dragging": dragging() === id,
                    "am-project-drop-before": drop()?.id === id && !drop()?.after,
                    "am-project-drop-after": drop()?.id === id && drop()?.after,
                  }}
                >
                  <SidebarSectionHeader
                    ref={(el) => {
                      if (!draggable) return
                      draggable.ref(el)
                      // The row action buttons and menus keep their own pointer behavior.
                      el.addEventListener("pointerdown", (event) => {
                        if (event.target instanceof Element && event.target.closest(".am-sidebar-header-actions"))
                          return
                        draggable.dragActivators.onpointerdown?.(event)
                      })
                    }}
                    class="am-project-item"
                    expanded={project().expanded}
                    ariaLabel={project().label}
                    icon={<ProjectAvatar label={project().label} src={project().avatar} />}
                    title={project().missing ? props.t("agentManager.project.missing") : project().root}
                    label={
                      <>
                        <span class="am-project-label">{project().label}</span>
                        <Show when={props.count(project().id) !== undefined}>
                          <span class="am-project-count">({props.count(project().id)})</span>
                        </Show>
                        <Show when={project().missing}>
                          <Icon name="warning" size="small" />
                        </Show>
                      </>
                    }
                    actions={
                      <ProjectRowActions
                        branch={props.baseBranch(project().id)}
                        bindings={props.bindings}
                        t={props.t}
                        pinned={project().pinned}
                        onCreate={() => props.onCreate(project().id)}
                        onNew={() => props.onNew(project().id)}
                        onSection={() => props.onSection(project().id)}
                        onHistory={() => props.onHistory(project().id)}
                        onSettings={() => props.onSettings(project().id)}
                        onRemove={() => props.onRemove(project().id)}
                      />
                    }
                    onToggle={() => {
                      if (project().missing) return
                      const expanded = !project().expanded
                      props.onExpand(project().id, expanded)
                    }}
                    onClick={() => {
                      if (project().missing) return
                      if (!project().active) props.onSelect(project().id)
                    }}
                  />
                  <Show when={project().expanded}>
                    <ProjectBodySlot project={project} body={props.body} />
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
        <DragOverlay class="am-project-drag-layer">
          {(() => {
            const project = projects().find((item) => item.id === dragging())
            if (!project) return null
            return (
              <div class="am-wt-overlay am-project-overlay">
                <ProjectAvatar label={project.label} src={project.avatar} />
                <span>{project.label}</span>
              </div>
            )
          })()}
        </DragOverlay>
      </DragDropProvider>
      <ProjectsFooter t={props.t} onCreate={props.onCreateProject} onAdd={props.onAdd} onClone={props.onClone} />
    </div>
  )
}
