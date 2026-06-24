import { describe, expect, it } from "bun:test"
import { resolvePanelProjectDirectory } from "../../src/project-directory"
import { StackClientError, type StackClient } from "../../src/stack/client"
import { StackPanelController } from "../../src/stack/panel-controller"
import type {
  StackApplyResult,
  StackDraft,
  StackExtensionMessage,
  StackLoadData,
  StackPlan,
} from "../../src/stack/types"

const draft: StackDraft = {
  verticals: { data: { technologies: ["dbt"] } },
  resources: { "skill:dbt": { enabled: true } },
}

const data: StackLoadData = {
  catalog: {
    catalog: { revision: "catalog-1", verticals: [], resources: [] },
    resources: [],
    expected_resources: [],
  },
  state: {
    draft,
    resources: [],
    conflicts: [],
    config_revision: "config-1",
    catalog_revision: "catalog-1",
  },
}

const plan: StackPlan = {
  draft,
  plan_hash: "plan-1",
  config_revision: "config-1",
  catalog_revision: "catalog-1",
  actions: [],
  conflicts: [],
  warnings: [],
  prerequisites: [],
}

const result: StackApplyResult = {
  results: [],
  state: data.state,
}

class RecordingClient implements StackClient {
  calls: string[] = []
  applyError: Error | undefined

  async load(directory: string) {
    this.calls.push(`load:${directory}`)
    return data
  }

  async preview(directory: string, value: StackDraft) {
    this.calls.push(`preview:${directory}:${value.verticals.data.technologies.join(",")}`)
    return plan
  }

  async apply(directory: string, value: StackDraft, hash: string) {
    this.calls.push(`apply:${directory}:${value.resources["skill:dbt"]?.enabled}:${hash}`)
    if (this.applyError) throw this.applyError
    return result
  }
}

function setup(project: string | null) {
  const client = new RecordingClient()
  const messages: StackExtensionMessage[] = []
  const closed = { count: 0 }
  const controller = new StackPanelController(
    client,
    (message) => messages.push(message),
    () => closed.count++,
    project,
  )
  return { client, messages, closed, controller }
}

describe("Stack panel controller", () => {
  it("uses the active project and rejects ambiguous multi-root resolution", () => {
    const folders = [{ uri: { fsPath: "/one" } }, { uri: { fsPath: "/two" } }]
    expect(resolvePanelProjectDirectory("/two", folders)).toBe("/two")
    expect(resolvePanelProjectDirectory(undefined, folders)).toBeNull()
    expect(resolvePanelProjectDirectory(undefined, undefined)).toBeNull()
  })

  it("renders project-required without calling the backend", async () => {
    const value = setup(null)
    await value.controller.load()
    await value.controller.handle({ type: "stackPreview", draft })
    await value.controller.handle({ type: "stackApply", draft, planHash: "plan-1" })
    expect(value.client.calls).toEqual([])
    expect(value.messages).toEqual([
      { type: "stackProjectRequired" },
      { type: "stackProjectRequired" },
      { type: "stackProjectRequired" },
    ])
  })

  it("forwards the draft to preview unchanged", async () => {
    const value = setup("/project")
    await value.controller.handle({ type: "stackPreview", draft })
    expect(value.client.calls).toEqual(["preview:/project:dbt"])
    expect(value.messages).toEqual([{ type: "stackPreviewResult", plan }])
  })

  it("reports a stale apply after reconciling core state", async () => {
    const value = setup("/project")
    value.client.applyError = new StackClientError("Plan changed", "stale_plan", 409)
    await value.controller.handle({ type: "stackApply", draft, planHash: "plan-1" })
    expect(value.client.calls).toEqual(["apply:/project:true:plan-1", "load:/project"])
    expect(value.messages).toEqual([
      {
        type: "stackError",
        operation: "apply",
        message: "Plan changed",
        code: "stale_plan",
        stale: true,
        data,
      },
    ])
  })

  it("cancels without loading, previewing, or applying", async () => {
    const value = setup("/project")
    await value.controller.handle({ type: "stackCancel" })
    expect(value.client.calls).toEqual([])
    expect(value.closed.count).toBe(1)
  })

  it("applies the exact hash and reconciles core state before reporting success", async () => {
    const value = setup("/project")
    await value.controller.handle({ type: "stackApply", draft, planHash: "plan-1" })
    expect(value.client.calls).toEqual(["apply:/project:true:plan-1", "load:/project"])
    expect(value.messages).toEqual([{ type: "stackApplyResult", result, data }])
  })

  it("retains typed transactional failure details after reloading core state", async () => {
    const value = setup("/project")
    const detail = {
      code: "apply_failed" as const,
      message: "Stack changes could not be applied.",
      rollback: true,
      results: [
        {
          resource: "skill:dbt",
          action: "install" as const,
          success: false,
          message: "The verified artifact could not be installed.",
        },
      ],
    }
    value.client.applyError = new StackClientError(detail.message, detail.code, 500, detail)

    await value.controller.handle({ type: "stackApply", draft, planHash: "plan-1" })

    expect(value.client.calls).toEqual(["apply:/project:true:plan-1", "load:/project"])
    expect(value.messages).toEqual([{ type: "stackApplyFailure", failure: detail, data }])
  })

  it("serializes reload behind apply and uses the post-apply reconciliation", async () => {
    const messages: StackExtensionMessage[] = []
    const pending = Promise.withResolvers<StackApplyResult>()
    const calls: string[] = []
    const client: StackClient = {
      load: async (directory) => {
        calls.push(`load:${directory}`)
        return data
      },
      preview: async () => plan,
      apply: (directory) => {
        calls.push(`apply:${directory}`)
        return pending.promise
      },
    }
    const controller = new StackPanelController(
      client,
      (message) => messages.push(message),
      () => {},
      "/one",
    )

    const apply = controller.handle({ type: "stackApply", draft, planHash: "plan-1" })
    const reload = controller.load()
    expect(calls).toEqual(["apply:/one"])

    pending.resolve(result)
    await Promise.all([apply, reload])

    expect(calls).toEqual(["apply:/one", "load:/one"])
    expect(messages).toEqual([{ type: "stackApplyResult", result, data }])
  })

  it("defers project changes until apply reconciliation finishes", async () => {
    const messages: StackExtensionMessage[] = []
    const pending = Promise.withResolvers<StackApplyResult>()
    const calls: string[] = []
    const client: StackClient = {
      load: async (directory) => {
        calls.push(`load:${directory}`)
        return data
      },
      preview: async () => plan,
      apply: (directory) => {
        calls.push(`apply:${directory}`)
        return pending.promise
      },
    }
    const controller = new StackPanelController(
      client,
      (message) => messages.push(message),
      () => {},
      "/one",
    )

    const apply = controller.handle({ type: "stackApply", draft, planHash: "plan-1" })
    const change = controller.setProject("/two")
    const reload = controller.load()
    expect(calls).toEqual(["apply:/one"])

    pending.resolve(result)
    await Promise.all([apply, change, reload])

    expect(calls).toEqual(["apply:/one", "load:/one", "load:/two"])
    expect(messages).toEqual([
      { type: "stackApplyResult", result, data },
      { type: "stackLoadResult", data },
    ])
  })

  it("drops a load response after the selected project changes", async () => {
    const messages: StackExtensionMessage[] = []
    const pending = Promise.withResolvers<StackLoadData>()
    const client: StackClient = {
      load: () => pending.promise,
      preview: async () => plan,
      apply: async () => result,
    }
    const controller = new StackPanelController(
      client,
      (message) => messages.push(message),
      () => {},
      "/one",
    )
    const load = controller.load()
    controller.setProject("/two")
    pending.resolve(data)
    await load
    expect(messages).toEqual([])
  })

  it("drops responses after disposal so a reopened panel cannot receive them", async () => {
    const messages: StackExtensionMessage[] = []
    const pending = Promise.withResolvers<StackPlan>()
    const client: StackClient = {
      load: async () => data,
      preview: () => pending.promise,
      apply: async () => result,
    }
    const controller = new StackPanelController(
      client,
      (message) => messages.push(message),
      () => {},
      "/one",
    )
    const preview = controller.handle({ type: "stackPreview", draft })
    controller.dispose()
    pending.resolve(plan)
    await preview
    expect(messages).toEqual([])
  })

  it("keeps only the newest response when operations overlap", async () => {
    const messages: StackExtensionMessage[] = []
    const first = Promise.withResolvers<StackPlan>()
    const second = Promise.withResolvers<StackPlan>()
    const queue = [first, second]
    const client: StackClient = {
      load: async () => data,
      preview: () => queue.shift()!.promise,
      apply: async () => result,
    }
    const controller = new StackPanelController(
      client,
      (message) => messages.push(message),
      () => {},
      "/one",
    )
    const old = controller.handle({ type: "stackPreview", draft })
    const latest = controller.handle({ type: "stackPreview", draft })
    first.resolve(plan)
    second.resolve({ ...plan, plan_hash: "plan-2" })
    await Promise.all([old, latest])
    expect(messages).toEqual([{ type: "stackPreviewResult", plan: { ...plan, plan_hash: "plan-2" } }])
  })
})
