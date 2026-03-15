import z from "zod"
import path from "path"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { CodeIndexManager } from "@/indexing/manager"
import { toIndexingConfigInput } from "@/indexing/config-bridge"
import { Log } from "@/util/log"
import type { VectorStoreSearchResult } from "@/indexing/interfaces"

const log = Log.create({ service: "kilocode-indexing" })

export namespace KiloIndexing {
  export const Status = z
    .object({
      state: z.enum(["Disabled", "In Progress", "Complete", "Error"]),
      message: z.string(),
      processedFiles: z.number().int().nonnegative(),
      totalFiles: z.number().int().nonnegative(),
      percent: z.number().int().min(0).max(100),
    })
    .meta({ ref: "IndexingStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = BusEvent.define(
    "indexing.status",
    z.object({
      status: Status,
    }),
  )

  const state = Instance.state(
    async () => {
      log.info("initializing project indexing", { workspacePath: Instance.directory })
      const cache = path.join(Global.Path.state, "indexing")
      const manager = new CodeIndexManager(Instance.directory, cache)
      const input = toIndexingConfigInput((await Config.get()).indexing)

      const publish = async () => {
        const status = normalize(manager)
        await Bus.publish(Event, { status })
      }

      const unsub = manager.onProgressUpdate.on(() => {
        publish().catch((err) => {
          log.error("failed to publish indexing status", { err })
        })
      })

      await manager.initialize(input)
      log.info("project indexing initialized", {
        workspacePath: Instance.directory,
        featureEnabled: manager.isFeatureEnabled,
        featureConfigured: manager.isFeatureConfigured,
        state: manager.getCurrentStatus().systemStatus,
      })
      await publish()

      return {
        manager,
        publish,
        dispose() {
          unsub.dispose()
          manager.dispose()
        },
      }
    },
    async (entry) => {
      entry.dispose()
    },
  )

  export async function init() {
    await state()
  }

  export async function current(): Promise<Status> {
    return normalize((await state()).manager)
  }

  export async function search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const manager = (await state()).manager
    return manager.searchIndex(query, directoryPrefix)
  }

  function normalize(manager: CodeIndexManager): Status {
    const config = manager.getCurrentStatus()
    const files = config.currentItemUnit === "files"
    const processedFiles = files ? config.processedItems : 0
    const totalFiles = files ? config.totalItems : 0
    const percent = totalFiles > 0 ? Math.min(100, Math.max(0, Math.round((processedFiles / totalFiles) * 100))) : 0

    if (!manager.isFeatureEnabled || !manager.isFeatureConfigured) {
      return {
        state: "Disabled",
        message: config.message || "Indexing disabled.",
        processedFiles: 0,
        totalFiles: 0,
        percent: 0,
      }
    }

    if (config.systemStatus === "Error") {
      return {
        state: "Error",
        message: config.message || "Indexing failed.",
        processedFiles,
        totalFiles,
        percent,
      }
    }

    if (config.systemStatus === "Indexing") {
      return {
        state: "In Progress",
        message: config.message || "Indexing in progress.",
        processedFiles,
        totalFiles,
        percent,
      }
    }

    return {
      state: "Complete",
      message: config.message || "Index up-to-date.",
      processedFiles,
      totalFiles,
      percent: totalFiles > 0 ? percent : 100,
    }
  }
}
