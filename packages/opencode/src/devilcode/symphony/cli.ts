import fs from "node:fs"
import path from "node:path"
import { cmd } from "@/cli/cmd/cmd"
import { parseWorkflowMd } from "./config/workflow-md"
import { watchWorkflowMd } from "./config/watcher"
import { createOrchestrator } from "./orchestrator"
import { LinearTracker } from "./tracker/linear"
import { SymphonyRoutes } from "./server/routes"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.cli" })

export const SymphonyCommand = cmd({
  command: "symphony",
  describe: "Start the Symphony autonomous daemon",
  builder: (yargs) =>
    yargs
      .option("workflow", {
        type: "string",
        describe: "Path to WORKFLOW.md file",
        default: "WORKFLOW.md",
      })
      .option("port", {
        type: "number",
        describe: "HTTP server port (0 for random)",
      }),
  handler: async (args) => {
    const workflowPath = path.resolve(args.workflow)

    if (!fs.existsSync(workflowPath)) {
      log.error(`WORKFLOW.md not found at ${workflowPath}`)
      process.exit(1)
    }

    const content = await fs.promises.readFile(workflowPath, "utf-8")
    const { config, promptTemplate } = parseWorkflowMd(content)

    const tracker = new LinearTracker(config.tracker.endpoint, config.tracker.api_key)
    const orchestrator = createOrchestrator(tracker, config, promptTemplate)

    const watcher = watchWorkflowMd(workflowPath, ({ config: newConfig, promptTemplate: newTemplate }) => {
      orchestrator.updateConfig(newConfig, newTemplate)
    })

    const port = args.port ?? config.server.port
    const server = Bun.serve({
      port,
      fetch: SymphonyRoutes(orchestrator).fetch,
    })

    const actualPort = server.port
    log.info(`Symphony daemon started`)
    log.info(`Dashboard: http://localhost:${actualPort}/dashboard`)
    log.info(`API: http://localhost:${actualPort}/state`)
    log.info(`Project: ${config.tracker.project_slug}`)
    log.info(`Max concurrent: ${config.agent.max_concurrent_agents}`)
    log.info(`Poll interval: ${config.polling.interval_ms}ms`)

    await orchestrator.start()

    const shutdown = async () => {
      log.info("Shutting down...")
      watcher.close()
      await orchestrator.stop()
      server.stop()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  },
})
