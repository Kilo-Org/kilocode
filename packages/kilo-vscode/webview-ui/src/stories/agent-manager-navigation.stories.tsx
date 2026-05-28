/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DragDropProvider, DragDropSensors, SortableProvider } from "@thisbeyond/solid-dnd"
import { For, Show, createSignal, type JSX } from "solid-js"
import { StoryProviders } from "./StoryProviders"
import { WorktreeItem } from "../../agent-manager/WorktreeItem"
import SectionHeader from "../../agent-manager/SectionHeader"
import { SortableReviewTab, SortableTab } from "../../agent-manager/sortable-tab"
import { SortableTerminalTab } from "../../agent-manager/terminal/SortableTerminalTab"
import { nextTab, panelId, tabId } from "../../agent-manager/tab-accessibility"
import type { SectionState, SessionInfo, WorktreeState } from "../types/messages"
import "../../agent-manager/agent-manager.css"

const meta: Meta = {
  title: "AgentManager/Navigation",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

const noop = () => {}
const REVIEW = "review"
const TERM = "terminal:fixture"

function tree(id: string, branch: string): WorktreeState {
  return {
    id,
    branch,
    path: `/tmp/worktrees/${branch}`,
    parentBranch: "main",
    remote: "origin",
    createdAt: new Date(0).toISOString(),
  }
}

function WorktreeFixture() {
  const [active, setActive] = createSignal("wt-keyboard")
  const [collapsed, setCollapsed] = createSignal(false)
  const [deleted, setDeleted] = createSignal("")
  const section = (): SectionState => ({
    id: "navigation",
    name: "Accessibility fixes",
    color: "Blue",
    order: 0,
    collapsed: collapsed(),
  })
  const props = (wt: WorktreeState, label: string) => ({
    worktree: wt,
    label,
    active: active() === wt.id,
    pendingDelete: false,
    busy: false,
    working: false,
    stale: false,
    sessions: 1,
    grouped: false,
    groupStart: false,
    groupEnd: false,
    groupSize: 0,
    renaming: false,
    renameValue: "",
    closeKeybind: "Ctrl+Shift+W",
    openKeybind: "Ctrl+Shift+O",
    onClick: () => setActive(wt.id),
    onDelete: (e: MouseEvent) => {
      e.stopPropagation()
      setDeleted(wt.id)
    },
    onStartRename: noop,
    onRenameInput: noop,
    onCommitRename: noop,
    onCancelRename: noop,
    onRemoveStale: noop,
    onCopyPath: noop,
    onOpen: noop,
  })
  const first = tree("wt-keyboard", "fix/keyboard")
  const second = tree("wt-reader", "fix/screen-reader")
  return (
    <StoryProviders noPadding>
      <DragDropProvider>
        <DragDropSensors />
        <div style={{ width: "260px" }}>
          <SectionHeader
            section={section()}
            count={2}
            onToggle={() => setCollapsed(!collapsed())}
            onRename={noop}
            onDelete={noop}
            onSetColor={noop}
          >
            <Show when={!collapsed()}>
              <div class="am-section-group-body">
                <WorktreeItem {...props(first, "Keyboard navigation")} />
                <WorktreeItem {...props(second, "Screen reader navigation")} />
              </div>
            </Show>
          </SectionHeader>
          <output data-testid="worktree-state">
            {active()}|{deleted()}
          </output>
        </div>
      </DragDropProvider>
    </StoryProviders>
  )
}

export const WorktreesKeyboard: Story = {
  name: "Worktrees keyboard fixture",
  render: () => <WorktreeFixture />,
}

const session: SessionInfo = {
  id: "session-keyboard",
  title: "Implement navigation",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function TabsFixture() {
  const [tabs, setTabs] = createSignal([session.id, REVIEW, TERM])
  const [active, setActive] = createSignal(session.id)
  const close = (id: string) => {
    const current = tabs()
    const next = nextTab(current, id)
    setTabs(current.filter((tab) => tab !== id))
    if (active() !== id) return
    setActive(next ?? "")
  }
  return (
    <StoryProviders noPadding>
      <DragDropProvider>
        <DragDropSensors />
        <div class="am-tab-bar" style={{ width: "540px" }}>
          <div
            class="am-tab-list"
            role="tablist"
            aria-label="Open tabs"
            aria-orientation="horizontal"
            style={{ "--tab-count": `${tabs().length}` } as JSX.CSSProperties}
          >
            <SortableProvider ids={tabs()}>
              <For each={tabs()}>
                {(id) => (
                  <Show
                    when={id !== REVIEW && id !== TERM}
                    fallback={
                      id === REVIEW ? (
                        <SortableReviewTab
                          id={REVIEW}
                          label="Review"
                          tooltip="Review"
                          active={active() === REVIEW}
                          onSelect={() => setActive(REVIEW)}
                          onMiddleClick={noop}
                          onClose={() => close(REVIEW)}
                        />
                      ) : (
                        <SortableTerminalTab
                          id={TERM}
                          label="Shell"
                          tooltip="Shell"
                          active={active() === TERM}
                          onSelect={() => setActive(TERM)}
                          onMiddleClick={noop}
                          onClose={() => close(TERM)}
                        />
                      )
                    }
                  >
                    <SortableTab
                      tab={session}
                      active={active() === session.id}
                      busy={false}
                      onSelect={() => setActive(session.id)}
                      onMiddleClick={noop}
                      onClose={() => close(session.id)}
                    />
                  </Show>
                )}
              </For>
            </SortableProvider>
          </div>
        </div>
        <For each={tabs()}>
          {(id) => (
            <div
              id={panelId(id)}
              role="tabpanel"
              aria-labelledby={tabId(id)}
              data-testid={active() === id ? "selected-panel" : undefined}
              hidden={active() !== id}
            >
              {id}
            </div>
          )}
        </For>
      </DragDropProvider>
    </StoryProviders>
  )
}

export const TabsKeyboard: Story = {
  name: "Tabs keyboard fixture",
  render: () => <TabsFixture />,
}
