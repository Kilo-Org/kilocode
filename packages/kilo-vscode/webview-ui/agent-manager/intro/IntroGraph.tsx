import { For } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../src/context/language"
import { WorktreeItem } from "../WorktreeItem"

const examples = [
  { label: "A", branch: "feature-a", pr: 42, additions: 24, deletions: 8, approved: false },
  { label: "B", branch: "fix-b", pr: 43, additions: 12, deletions: 3, approved: true },
]
const noop = () => undefined

export function IntroGraph(props: { base: string }) {
  const { t } = useLanguage()

  return (
    <figure class="am-intro-graph">
      <figcaption class="am-intro-caption">{t("agentManager.intro.stage2.title")}</figcaption>
      <div class="am-intro-origin">
        <Icon name="folder" size="normal" />
        <div class="am-intro-node-text">
          <strong>{t("agentManager.intro.stage1.title")}</strong>
          <span>{t("agentManager.intro.stage1.text")}</span>
        </div>
        <code class="am-intro-base">{props.base}</code>
      </div>
      <div class="am-intro-branches">
        <For each={examples}>
          {(example) => {
            const label = () => `${t("agentManager.intro.stage3.title")} ${example.label}`
            const status = () =>
              t(example.approved ? "agentManager.intro.approved" : "agentManager.intro.checksRunning")
            return (
              <div class="am-intro-lane">
                <div
                  class="am-intro-preview"
                  role="img"
                  aria-label={`${label()}, ${example.branch}, ${t("agentManager.intro.graph.agent")} ${example.label}, ${t("agentManager.intro.graph.pr")} #${example.pr}: ${status()}`}
                  title={t("agentManager.intro.stage3.text")}
                >
                  <div inert>
                    <WorktreeItem
                      preview
                      worktree={{
                        id: `intro-${example.label}`,
                        branch: example.branch,
                        path: `.kilo/worktrees/${example.branch}`,
                        parentBranch: props.base,
                        createdAt: "2026-01-01T00:00:00.000Z",
                      }}
                      label={label()}
                      subtitle={example.branch}
                      active={false}
                      pendingDelete={false}
                      busy={false}
                      activity="done"
                      stale={false}
                      sessions={1}
                      grouped={false}
                      groupStart={false}
                      groupEnd={false}
                      groupSize={1}
                      renaming={false}
                      renameValue=""
                      closeKeybind=""
                      openKeybind=""
                      stats={{
                        worktreeId: `intro-${example.label}`,
                        files: 2,
                        additions: example.additions,
                        deletions: example.deletions,
                        ahead: 2,
                        behind: 0,
                      }}
                      pr={{
                        number: example.pr,
                        title: label(),
                        url: "",
                        state: "open",
                        review: example.approved ? "approved" : "pending",
                        checks: {
                          status: example.approved ? "success" : "pending",
                          total: 2,
                          passed: example.approved ? 2 : 1,
                          failed: 0,
                          pending: example.approved ? 0 : 1,
                          checks: [],
                        },
                        reviewers: [],
                        additions: example.additions,
                        deletions: example.deletions,
                        files: 2,
                      }}
                      onClick={noop}
                      onDelete={noop}
                      onStartRename={noop}
                      onRenameInput={noop}
                      onCommitRename={noop}
                      onCancelRename={noop}
                      onRemoveStale={noop}
                      onCopyPath={noop}
                      onOpen={noop}
                    />
                  </div>
                </div>
                <div class="am-intro-outcome">
                  <Icon name="arrow-right" size="small" />
                  <span>{t("agentManager.intro.graph.pr")}</span>
                </div>
              </div>
            )
          }}
        </For>
      </div>
      <p class="am-intro-caption">{t("agentManager.intro.stage2.text")}</p>
      <p class="am-intro-caption">{t("agentManager.intro.prDetection")}</p>
    </figure>
  )
}
