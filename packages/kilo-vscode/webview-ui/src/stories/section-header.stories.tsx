/** @jsxImportSource solid-js */
/**
 * Stories for SectionHeader — collapsible, color-coded section groups
 * in the Agent Manager sidebar, with WorktreeItem children.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import SectionHeader from "../../agent-manager/SectionHeader"
import { WorktreeItem } from "../../agent-manager/WorktreeItem"
import type { SectionState, WorktreeState, WorktreeGitStats } from "../types/messages"
import { DragDropProvider, DragDropSensors } from "@thisbeyond/solid-dnd"
import "../../agent-manager/agent-manager.css"

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "AgentManager/Sections",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const noop = () => {}

function sec(id: string, order: number, opts: Partial<SectionState> = {}): SectionState {
  return { id, name: `Section ${id}`, color: null, order, collapsed: false, ...opts }
}

function wt(id: string, branch: string, opts: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id,
    branch,
    path: `/tmp/worktrees/${branch}`,
    parentBranch: "main",
    remote: "origin",
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    ...opts,
  }
}

const baseStats: WorktreeGitStats = {
  worktreeId: "wt-1",
  files: 4,
  additions: 32,
  deletions: 8,
  ahead: 2,
  behind: 0,
}

const wtProps = {
  active: false,
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
  closeKeybind: "⌘⇧W",
  openKeybind: "⌘⇧O",
  onClick: noop,
  onDelete: noop,
  onStartRename: noop,
  onRenameInput: noop,
  onCommitRename: noop,
  onCancelRename: noop,
  onRemoveStale: noop,
  onCopyPath: noop,
  onOpen: noop,
}

const sectionProps = {
  onToggle: noop,
  onRename: noop,
  onDelete: noop,
  onSetColor: noop,
  onRenameEnd: noop,
  onMoveUp: noop,
  onMoveDown: noop,
}

/** DnD wrapper required by SectionHeader's createDroppable */
function DndWrap(props: { children: any }) {
  return (
    <DragDropProvider>
      <DragDropSensors />
      {props.children}
    </DragDropProvider>
  )
}

// ---------------------------------------------------------------------------
// Single section — expanded with worktrees
// ---------------------------------------------------------------------------

export const ExpandedWithItems: Story = {
  name: "Section — expanded with items",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "Backend", color: "Blue" })} count={3} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-1", "feat/api-auth")}
                label="feat/api-auth"
                stats={baseStats}
                shortcut={2}
              />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-2", "fix/db-pool")}
                label="fix/db-pool"
                stats={{ ...baseStats, worktreeId: "wt-2", additions: 5, deletions: 12 }}
                shortcut={3}
              />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-3", "chore/migrations")}
                label="chore/migrations"
                shortcut={4}
              />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Single section — collapsed
// ---------------------------------------------------------------------------

export const Collapsed: Story = {
  name: "Section — collapsed",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader
            section={sec("s1", 0, { name: "Backend", color: "Blue", collapsed: true })}
            count={3}
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/api-auth")} label="feat/api-auth" />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Empty section (no children)
// ---------------------------------------------------------------------------

export const Empty: Story = {
  name: "Section — empty",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "Unassigned", color: null })} count={0} {...sectionProps} />
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Color variations — all 8 palette colors
// ---------------------------------------------------------------------------

export const AllColors: Story = {
  name: "Section — all color variations",
  render: () => {
    const colors = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Magenta"] as const
    return (
      <StoryProviders noPadding>
        <div style={{ "max-height": "600px", overflow: "auto" }}>
          <DndWrap>
            {colors.map((color, i) => (
              <SectionHeader section={sec(`s-${color}`, i, { name: color, color })} count={1} {...sectionProps}>
                <div class="am-section-group-body">
                  <WorktreeItem
                    {...wtProps}
                    worktree={wt(`wt-${color}`, `feat/${color.toLowerCase()}`)}
                    label={`feat/${color.toLowerCase()}`}
                  />
                </div>
              </SectionHeader>
            ))}
          </DndWrap>
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// Default color (null) — uses panel border
// ---------------------------------------------------------------------------

export const DefaultColor: Story = {
  name: "Section — default color (no color set)",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "Miscellaneous", color: null })} count={2} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/misc-1")} label="feat/misc-1" />
              <WorktreeItem {...wtProps} worktree={wt("wt-2", "feat/misc-2")} label="feat/misc-2" />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Multiple sections — mixed states (sidebar layout)
// ---------------------------------------------------------------------------

export const MultipleSections: Story = {
  name: "Section — multiple sections mixed",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "600px", overflow: "auto" }}>
        <DndWrap>
          {/* Ungrouped worktree at the top */}
          <WorktreeItem {...wtProps} worktree={wt("wt-ungrouped", "main")} label="main" active shortcut={1} />

          {/* Expanded section with color */}
          <SectionHeader
            section={sec("s1", 0, { name: "Frontend", color: "Green" })}
            count={2}
            isFirst
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-f1", "feat/dashboard")}
                label="feat/dashboard"
                stats={baseStats}
                shortcut={2}
              />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-f2", "fix/css-grid")}
                label="fix/css-grid"
                stats={{ ...baseStats, worktreeId: "wt-f2", files: 1, additions: 2, deletions: 1, ahead: 1, behind: 0 }}
                shortcut={3}
              />
            </div>
          </SectionHeader>

          {/* Collapsed section */}
          <SectionHeader
            section={sec("s2", 1, { name: "Backend", color: "Blue", collapsed: true })}
            count={3}
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-b1", "feat/api")} label="feat/api" />
            </div>
          </SectionHeader>

          {/* Empty section */}
          <SectionHeader
            section={sec("s3", 2, { name: "DevOps", color: "Orange" })}
            count={0}
            isLast
            {...sectionProps}
          />

          {/* Another ungrouped worktree at the bottom */}
          <WorktreeItem {...wtProps} worktree={wt("wt-ungrouped2", "chore/deps")} label="chore/deps" />
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Section with grouped (multi-version) worktrees
// ---------------------------------------------------------------------------

export const WithVersions: Story = {
  name: "Section — with multi-version group inside",
  render: () => {
    const v1 = wt("wt-v1", "feat/search-v1", { groupId: "g1" })
    const v2 = wt("wt-v2", "feat/search-v2", { groupId: "g1" })
    const v3 = wt("wt-v3", "feat/search-v3", { groupId: "g1" })
    return (
      <StoryProviders noPadding>
        <div style={{ "max-height": "400px", overflow: "auto" }}>
          <DndWrap>
            <SectionHeader section={sec("s1", 0, { name: "Search", color: "Purple" })} count={4} {...sectionProps}>
              <div class="am-section-group-body">
                <WorktreeItem
                  {...wtProps}
                  worktree={v1}
                  label="feat/search-v1"
                  grouped
                  groupStart
                  groupEnd={false}
                  groupSize={3}
                  shortcut={2}
                />
                <WorktreeItem
                  {...wtProps}
                  worktree={v2}
                  label="feat/search-v2"
                  grouped
                  groupStart={false}
                  groupEnd={false}
                  groupSize={0}
                  shortcut={3}
                />
                <WorktreeItem
                  {...wtProps}
                  worktree={v3}
                  label="feat/search-v3"
                  grouped
                  groupStart={false}
                  groupEnd
                  groupSize={0}
                  shortcut={4}
                />
                {/* Non-grouped item in the same section */}
                <WorktreeItem
                  {...wtProps}
                  worktree={wt("wt-solo", "feat/search-config")}
                  label="feat/search-config"
                  shortcut={5}
                />
              </div>
            </SectionHeader>
          </DndWrap>
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// Section with active worktree
// ---------------------------------------------------------------------------

export const WithActiveWorktree: Story = {
  name: "Section — with active worktree highlighted",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "In Progress", color: "Cyan" })} count={3} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/auth")} label="feat/auth" />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-2", "feat/payments")}
                label="feat/payments"
                active
                stats={baseStats}
              />
              <WorktreeItem {...wtProps} worktree={wt("wt-3", "feat/email")} label="feat/email" />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Section with busy/working worktree
// ---------------------------------------------------------------------------

export const WithBusyWorktree: Story = {
  name: "Section — with busy worktree (spinner)",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "Running", color: "Yellow" })} count={2} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/generate")} label="feat/generate" working />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-2", "feat/refactor")}
                label="feat/refactor"
                stats={baseStats}
              />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Section with long name (overflow)
// ---------------------------------------------------------------------------

export const LongSectionName: Story = {
  name: "Section — long name with text overflow",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader
            section={sec("s1", 0, {
              name: "This Is A Very Long Section Name That Should Overflow Gracefully",
              color: "Red",
            })}
            count={1}
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-1", "feat/long-branch-name-that-also-overflows")}
                label="feat/long-branch-name-that-also-overflows"
              />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Section with first/last indicators (move up/down)
// ---------------------------------------------------------------------------

export const FirstAndLastSection: Story = {
  name: "Section — first and last (move constraints)",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader
            section={sec("s1", 0, { name: "First Section", color: "Green" })}
            count={1}
            isFirst
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/top")} label="feat/top" />
            </div>
          </SectionHeader>
          <SectionHeader
            section={sec("s2", 1, { name: "Last Section", color: "Magenta" })}
            count={1}
            isLast
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-2", "feat/bottom")} label="feat/bottom" />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Dense sidebar — many sections with varying counts
// ---------------------------------------------------------------------------

export const DenseSidebar: Story = {
  name: "Section — dense sidebar with many sections",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "600px", overflow: "auto" }}>
        <DndWrap>
          {/* Ungrouped */}
          <WorktreeItem {...wtProps} worktree={wt("wt-main", "main")} label="main" active shortcut={1} />

          <SectionHeader section={sec("s1", 0, { name: "Auth", color: "Red" })} count={2} isFirst {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-a1", "feat/login")} label="feat/login" stats={baseStats} />
              <WorktreeItem {...wtProps} worktree={wt("wt-a2", "feat/oauth")} label="feat/oauth" />
            </div>
          </SectionHeader>

          <SectionHeader
            section={sec("s2", 1, { name: "Payments", color: "Green", collapsed: true })}
            count={4}
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-p1", "feat/stripe")} label="feat/stripe" />
            </div>
          </SectionHeader>

          <SectionHeader section={sec("s3", 2, { name: "Infra", color: "Orange" })} count={1} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-i1", "chore/docker")} label="chore/docker" working />
            </div>
          </SectionHeader>

          <SectionHeader
            section={sec("s4", 3, { name: "Docs", color: "Cyan", collapsed: true })}
            count={2}
            {...sectionProps}
          >
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-d1", "docs/api")} label="docs/api" />
            </div>
          </SectionHeader>

          <SectionHeader
            section={sec("s5", 4, { name: "Testing", color: "Purple" })}
            count={0}
            isLast
            {...sectionProps}
          />
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Section with stale worktree
// ---------------------------------------------------------------------------

export const WithStaleWorktree: Story = {
  name: "Section — with stale worktree warning",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "Stale Items", color: "Red" })} count={2} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem {...wtProps} worktree={wt("wt-1", "feat/old-branch")} label="feat/old-branch" stale />
              <WorktreeItem {...wtProps} worktree={wt("wt-2", "feat/active")} label="feat/active" stats={baseStats} />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Sections with PR badges on worktrees
// ---------------------------------------------------------------------------

export const WithPRBadges: Story = {
  name: "Section — worktrees with PR badges",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ "max-height": "400px", overflow: "auto" }}>
        <DndWrap>
          <SectionHeader section={sec("s1", 0, { name: "In Review", color: "Blue" })} count={3} {...sectionProps}>
            <div class="am-section-group-body">
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-1", "feat/api-v2")}
                label="feat/api-v2"
                subtitle="feat/api-v2"
                stats={baseStats}
                pr={{
                  number: 42,
                  title: "feat: api v2",
                  url: "#",
                  state: "open",
                  review: "approved",
                  additions: 120,
                  deletions: 30,
                  files: 5,
                  checks: { status: "success", total: 5, passed: 5, failed: 0, pending: 0, items: [] },
                }}
              />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-2", "fix/race-cond")}
                label="fix/race-cond"
                subtitle="fix/race-cond"
                pr={{
                  number: 87,
                  title: "fix: race condition",
                  url: "#",
                  state: "open",
                  review: "changes_requested",
                  additions: 15,
                  deletions: 8,
                  files: 3,
                  checks: { status: "failure", total: 5, passed: 3, failed: 2, pending: 0, items: [] },
                }}
              />
              <WorktreeItem
                {...wtProps}
                worktree={wt("wt-3", "feat/cache")}
                label="feat/cache"
                subtitle="feat/cache"
                pr={{
                  number: 103,
                  title: "feat: cache layer",
                  url: "#",
                  state: "draft",
                  review: null,
                  additions: 200,
                  deletions: 0,
                  files: 8,
                  checks: { status: "pending", total: 5, passed: 0, failed: 0, pending: 5, items: [] },
                }}
              />
            </div>
          </SectionHeader>
        </DndWrap>
      </div>
    </StoryProviders>
  ),
}
