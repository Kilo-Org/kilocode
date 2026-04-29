import { Hono, type Context } from "hono"
import type { OrchestratorHandle } from "../orchestrator"
import { renderDashboard } from "./dashboard"

export function SymphonyRoutes(orchestrator: OrchestratorHandle) {
  const app = new Hono()

  app.get("/state", (c: Context) => {
    return c.json(orchestrator.getState())
  })

  app.get("/issue/:identifier", (c: Context) => {
    const identifier = c.req.param("identifier")
    const state = orchestrator.getState()
    const running = state.running.find((r) => r.identifier === identifier)
    const retrying = state.retrying.find((r) => r.identifier === identifier)

    if (!running && !retrying) {
      return c.json({ error: `Issue ${identifier} not found in running or retry queue` }, 404)
    }

    return c.json({ running: running ?? null, retrying: retrying ?? null })
  })

  app.post("/refresh", async (c: Context) => {
    await orchestrator.refresh()
    return c.json({ ok: true, message: "Immediate poll triggered" })
  })

  app.get("/dashboard", (c: Context) => {
    const state = orchestrator.getState()
    const html = renderDashboard(state)
    return c.html(html)
  })

  app.get("/config", (c: Context) => {
    return c.json({ message: "Config endpoint - current effective config" })
  })

  return app
}
