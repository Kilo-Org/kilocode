const dir = process.env.KILO_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.KILO_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.KILO_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.KILO_E2E_MODEL ?? "kilo/kilo-auto/frontier"
const requirePaid = process.env.KILO_E2E_REQUIRE_PAID === "true"
const parts = model.split("/")
const providerID = parts[0] ?? "kilo" // kilocode_change
const modelID = parts.slice(1).join("/") || "kilo-auto/frontier" // kilocode_change
const now = Date.now()

const seed = async () => {
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Config } = await import("../src/config/config")
  const { Provider } = await import("../src/provider/provider")
  const { Session } = await import("../src/session")
  const { MessageID, PartID } = await import("../src/session/schema")
  const { Project } = await import("../src/project/project")
  const { ModelID, ProviderID } = await import("../src/provider/schema")
  const { ToolRegistry } = await import("../src/tool/registry")

  try {
    await Instance.provide({
      directory: dir,
      init: InstanceBootstrap,
      fn: async () => {
        await Config.waitForDependencies()
        await ToolRegistry.ids()

        if (requirePaid && providerID === "kilo" && !process.env.KILO_API_KEY) {
          throw new Error("KILO_API_KEY is required when KILO_E2E_REQUIRE_PAID=true")
        }

        const info = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        if (requirePaid) {
          const paid =
            info.cost.input > 0 || info.cost.output > 0 || info.cost.cache.read > 0 || info.cost.cache.write > 0
          if (!paid) {
            throw new Error(`KILO_E2E_MODEL must resolve to a paid model: ${providerID}/${modelID}`)
          }
        }

        const session = await Session.create({ title })
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: now },
          agent: "code", // kilocode_change - renamed from "build" to "code"
          model: {
            providerID: ProviderID.make(providerID),
            modelID: ModelID.make(modelID),
          },
        }
        const part = {
          id: partID,
          sessionID: session.id,
          messageID,
          type: "text" as const,
          text,
          time: { start: now },
        }
        await Session.updateMessage(message)
        await Session.updatePart(part)
        await Project.update({ projectID: Instance.project.id, name: "E2E Project" })
      },
    })
  } finally {
    await Instance.disposeAll().catch(() => {})
  }
}

await seed()
