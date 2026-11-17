/**
 * CompactionQueuedBanner
 * Shows while a compaction marker is written but not started, which happens when /compact is
 * requested during a running turn. Derived from the persisted marker message, so it clears as
 * soon as the summary message appears.
 */

import { Component, Show, createMemo } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { queuedCompaction } from "../../context/session-queue"

export const CompactionQueuedBanner: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const queued = createMemo(
    () => !!queuedCompaction(session.messages(), (msg) => session.getParts(msg.id), session.revert() ?? undefined),
  )

  return (
    <Show when={queued()}>
      <div class="compaction-queued-banner" role="status">
        <Icon name="archive" size="small" />
        <span>
          {session.status() === "busy"
            ? language.t("session.compaction.queued.busy")
            : language.t("session.compaction.queued")}
        </span>
      </div>
    </Show>
  )
}
