/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@kilocode/sdk/v2"
import { createSignal, onMount, Show, type ParentProps } from "solid-js" // kilocode_change
import { ProjectProvider, useProject } from "../../../src/context/project" // kilocode_change
import { SDKProvider } from "../../../src/context/sdk"
import { DataProvider, useData } from "../../../src/context/data"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function global(payload: Event): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function emitEvent(events: ReturnType<typeof createEventSource>, payload: Event) {
  events.emit(global(payload))
}

// kilocode_change start - initialize Kilo's project filter before mounting V2 event consumers
function Ready(props: ParentProps) {
  const project = useProject()
  const [ready, setReady] = createSignal(false)
  onMount(async () => {
    await project.sync()
    setReady(true)
  })
  return <Show when={ready()}>{props.children}</Show>
}
// kilocode_change end

test("refreshes resources into reactive getters", async () => {
  const location = {
    directory,
    project: { id: "proj_test", directory },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test")
      return json({
        data: {
          id: "ses_test",
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Test session",
          location: { directory },
        },
      })
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [{ id: "build", request: { headers: {}, body: {} }, mode: "primary", hidden: false, permissions: [] }],
      })
    return undefined
  })
  const events = createEventSource()
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    expect(data.location.default()).toEqual({ directory })
    expect(data.session.get("ses_test")).toBeUndefined()
    expect(data.location.agent.list(location)).toBeUndefined()

    await data.session.refresh("ses_test")
    await data.location.agent.refresh()

    expect(data.session.get("ses_test")?.title).toBe("Test session")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes integrations after integration updates", async () => {
  const events = createEventSource()
  const requests = { integration: 0, model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname !== "/api/integration") return
    requests.integration++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data:
        requests.integration === 1
          ? []
          : [
              {
                id: "openai",
                name: "OpenAI",
                methods: [{ type: "key" }],
              },
            ],
    })
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => data.location.integration.list() !== undefined)
    expect(data.location.integration.list()).toEqual([])
    const before = { ...requests }

    emitEvent(events, { id: "evt_integration", type: "integration.updated", properties: {} })
    await wait(() => data.location.integration.list()?.length === 1)
    await wait(() => requests.model > before.model && requests.provider > before.provider)
    expect(data.location.integration.list()?.[0]).toMatchObject({ id: "openai", name: "OpenAI" })
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes effective catalog data after catalog updates", async () => {
  const events = createEventSource()
  const requests = { model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          {/* kilocode_change start - initialize Kilo's project filter before consuming catalog events */}
          <Ready>
            <DataProvider>
              <box />
            </DataProvider>
          </Ready>
          {/* kilocode_change end */}
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => requests.model > 0 && requests.provider > 0)
    const before = { ...requests }
    emitEvent(events, { id: "evt_catalog", type: "catalog.updated", properties: {} })
    await wait(() => requests.model > before.model && requests.provider > before.provider)
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes references after updates", async () => {
  const events = createEventSource()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/reference") return
    requests++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: requests === 1 ? [] : [{ name: "docs", path: "/docs", source: { type: "local", path: "/docs" } }],
    })
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => requests === 1)
    emitEvent(events, { id: "evt_reference_1", type: "reference.updated", properties: {} })
    await wait(() => data.location.reference.list()?.length === 1)
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
  } finally {
    app.renderer.destroy()
  }
})

test("settles pending tools when a live failure arrives", async () => {
  const events = createEventSource()
  const calls = createFetch()
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      properties: { sessionID: "session-1", messageID: "msg_agent_1", timestamp: 0, agent: "build" },
    })
    emitEvent(events, {
      id: "evt_model_1",
      type: "session.next.model.switched",
      properties: {
        sessionID: "session-1",
        messageID: "msg_model_1",
        timestamp: 0,
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_step_started_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 1,
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_input_1",
      type: "session.next.tool.input.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 2,
        callID: "call-1",
        name: "bash",
      },
    })
    emitEvent(events, {
      id: "evt_called_1",
      type: "session.next.tool.called",
      properties: {
        sessionID: "session-1",
        timestamp: 2,
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        tool: "bash",
        input: {},
        provider: { executed: false, metadata: { fake: { call: true } } },
      },
    })
    emitEvent(events, {
      id: "evt_failed_1",
      type: "session.next.tool.failed",
      properties: {
        sessionID: "session-1",
        timestamp: 3,
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        error: { type: "unknown", message: "aborted" },
        provider: { executed: false, metadata: { fake: { result: true } } },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.list("session-1")?.[0]
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "error"
      )
    })

    const assistant = sync.session.message.list("session-1")?.[0]
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    expect(assistant.id).toBe("msg_explicit_assistant_9")
    const tool = assistant.content[0]
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("error")
    if (tool.state.status !== "error") return
    expect(tool.state.error).toEqual({ type: "unknown", message: "aborted" })
    expect(tool.state.input).toEqual({})
    expect(tool.state.structured).toEqual({})
    expect(tool.state.content).toEqual([])
    expect(tool.provider).toEqual({
      executed: false,
      metadata: { fake: { call: true } },
      resultMetadata: { fake: { result: true } },
    })
    expect((sync.session.message.list("session-1") ?? []).map((message) => message.type)).toEqual([
      "assistant",
      "model-switched",
      "agent-switched",
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("renders admitted prompts only after promotion", async () => {
  const events = createEventSource()
  const calls = createFetch()
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_admitted_1",
      type: "session.next.prompt.admitted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    expect(sync.session.message.list("session-1") ?? []).toEqual([])

    emitEvent(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 1,
        prompt: { text: "hello" },
        timeCreated: 0,
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    const message = sync.session.message.list("session-1")?.[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: "msg_user_1", text: "hello" })
  } finally {
    app.renderer.destroy()
  }
})

test("renders a promoted prompt when admission was missed", async () => {
  const events = createEventSource()
  const calls = createFetch()
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 1,
        prompt: { text: "hello" },
        timeCreated: 0,
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(sync.session.message.list("session-1")?.[0]?.id).toBe("msg_user_1")
  } finally {
    app.renderer.destroy()
  }
})

test("projects live context updates with their message ID", async () => {
  const events = createEventSource()
  const calls = createFetch()
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_context_1",
      type: "session.next.context.updated",
      properties: {
        sessionID: "session-1",
        messageID: "msg_context_1",
        timestamp: 1,
        text: "Updated context",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: "msg_context_1",
      type: "system",
      text: "Updated context",
    })
  } finally {
    app.renderer.destroy()
  }
})

// kilocode_change start - preserve Kilo's V2 hydration-race coverage after the DataProvider extraction
test("preserves live events while message hydration is in flight", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      properties: { sessionID: "session-1", messageID: "msg_agent_1", timestamp: 0, agent: "build" },
    })
    response.resolve(json({ data: [] }))
    await hydration

    expect(data.session.message.list("session-1")?.map((message) => [message.id, message.type])).toEqual([
      ["msg_agent_1", "agent-switched"],
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("does not replay live events already represented by the hydration snapshot", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_step_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_1",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_text_started_1",
      type: "session.next.text.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_1",
        timestamp: 2,
        textID: "text-1",
      },
    })
    emitEvent(events, {
      id: "evt_text_delta_1",
      type: "session.next.text.delta",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_1",
        timestamp: 3,
        textID: "text-1",
        delta: "hello",
      },
    })
    await wait(() => {
      const message = data.session.message.list("session-1")?.[0]
      return message?.type === "assistant" && message.content[0]?.type === "text" && message.content[0].text === "hello"
    })
    response.resolve(
      json({
        data: [
          {
            id: "msg_assistant_1",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [{ type: "text", id: "text-1", text: "hello" }],
            time: { created: 1 },
          },
        ],
      }),
    )
    await hydration

    const message = data.session.message.list("session-1")?.[0]
    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.content).toEqual([{ type: "text", id: "text-1", text: "hello" }])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps a complete hydration snapshot over a partial new live assistant", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_step_partial",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_partial",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    response.resolve(
      json({
        data: [
          {
            id: "msg_assistant_partial",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [{ type: "text", id: "text-1", text: "complete output" }],
            finish: "stop",
            time: { created: 1, completed: 4 },
          },
        ],
      }),
    )
    await hydration

    expect(JSON.parse(JSON.stringify(data.session.message.list("session-1")?.[0]))).toMatchObject({
      finish: "stop",
      time: { created: 1, completed: 4 },
      content: [{ type: "text", id: "text-1", text: "complete output" }],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("keeps complete snapshot content over a partial live delta", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_step_existing",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_existing",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => data.session.message.list("session-1")?.[0]?.id === "msg_assistant_existing")
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_text_started_partial",
      type: "session.next.text.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_existing",
        timestamp: 2,
        textID: "text-1",
      },
    })
    emitEvent(events, {
      id: "evt_text_delta_partial",
      type: "session.next.text.delta",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_existing",
        timestamp: 3,
        textID: "text-1",
        delta: "partial",
      },
    })
    response.resolve(
      json({
        data: [
          {
            id: "msg_assistant_existing",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [{ type: "text", id: "text-1", text: "partial and complete" }],
            finish: "stop",
            time: { created: 1, completed: 5 },
          },
        ],
      }),
    )
    await hydration

    expect(JSON.parse(JSON.stringify(data.session.message.list("session-1")?.[0]))).toMatchObject({
      finish: "stop",
      time: { created: 1, completed: 5 },
      content: [{ type: "text", id: "text-1", text: "partial and complete" }],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("replaces stale cached messages while preserving in-flight live messages", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 1,
        prompt: { text: "stale" },
        timeCreated: 0,
      },
    })
    await wait(() => data.session.message.list("session-1")?.[0]?.id === "msg_user_1")
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      properties: { sessionID: "session-1", messageID: "msg_agent_1", timestamp: 2, agent: "build" },
    })
    await wait(() => data.session.message.list("session-1")?.[0]?.id === "msg_agent_1")
    response.resolve(
      json({
        data: [{ id: "msg_user_1", type: "user", text: "fresh", time: { created: 0 } }],
      }),
    )
    await hydration

    expect(data.session.message.list("session-1")?.map((message) => [message.id, message.type])).toEqual([
      ["msg_agent_1", "agent-switched"],
      ["msg_user_1", "user"],
    ])
    expect(data.session.message.list("session-1")?.[1]).toMatchObject({ text: "fresh" })
  } finally {
    app.renderer.destroy()
  }
})

test("preserves snapshot order and metadata for in-flight message updates", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Ready>
            <DataProvider>
              <Probe />
            </DataProvider>
          </Ready>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_step_older",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_older",
        timestamp: 0,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_step_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_old",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => data.session.message.list("session-1")?.[0]?.id === "msg_assistant_old")
    const hydration = data.session.message.refresh("session-1")
    emitEvent(events, {
      id: "evt_text_1",
      type: "session.next.text.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_old",
        timestamp: 2,
        textID: "text-1",
      },
    })
    emitEvent(events, {
      id: "evt_text_older",
      type: "session.next.text.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_older",
        timestamp: 2,
        textID: "text-older",
      },
    })
    await wait(() => {
      const messages = data.session.message.list("session-1") ?? []
      return messages.every((message) => message.type !== "assistant" || message.content[0]?.type === "text")
    })
    response.resolve(
      json({
        data: [
          {
            id: "msg_assistant_new",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [],
            time: { created: 3 },
          },
          {
            id: "msg_assistant_old",
            type: "assistant",
            metadata: { source: "snapshot" },
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [],
            time: { created: 1 },
          },
        ],
      }),
    )
    await hydration
    emitEvent(events, {
      id: "evt_step_late_duplicate",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_assistant_old",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })

    expect(data.session.message.list("session-1")?.map((message) => message.id)).toEqual([
      "msg_assistant_new",
      "msg_assistant_old",
      "msg_assistant_older",
    ])
    expect(JSON.parse(JSON.stringify(data.session.message.list("session-1")?.[1]))).toMatchObject({
      metadata: { source: "snapshot" },
      content: [{ type: "text", id: "text-1", text: "" }],
    })
    expect(JSON.parse(JSON.stringify(data.session.message.list("session-1")?.[2]))).toMatchObject({
      content: [{ type: "text", id: "text-older", text: "" }],
    })
  } finally {
    app.renderer.destroy()
  }
})
// kilocode_change end
