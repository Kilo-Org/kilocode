import fs from "node:fs"
import { Bus } from "@/bus"
import { SymphonyEvent } from "../events"
import { parseWorkflowMd } from "./workflow-md"
import type { SymphonyConfig } from "./schema"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.config.watcher" })

interface WatcherState {
  config: SymphonyConfig
  promptTemplate: string
}

export function watchWorkflowMd(
  path: string,
  onReload: (state: WatcherState) => void,
): { close: () => void } {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = fs.watch(path, (_eventType) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      try {
        const content = await fs.promises.readFile(path, "utf-8")
        const { config, promptTemplate } = parseWorkflowMd(content)
        onReload({ config, promptTemplate })
        Bus.publish(SymphonyEvent.ConfigReloaded, { source: "workflow_md" })
        log.info("WORKFLOW.md reloaded successfully")
      } catch (e) {
        log.error("Failed to reload WORKFLOW.md, keeping last known good config", { error: e })
      }
    }, 100)
  })

  return {
    close() {
      if (debounceTimer) clearTimeout(debounceTimer)
      watcher.close()
    },
  }
}
