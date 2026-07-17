import { describe, expect, test } from "bun:test"
import {
  fetchCloudSession,
  fetchCloudSessionForImport,
  prepareSessionImport,
  SessionImportValidationError,
} from "../src/cloud-sessions"

async function expectStalledFetchToTimeOut(run: () => Promise<unknown>) {
  const fetch = globalThis.fetch
  const timeout = AbortSignal.timeout
  let delay: number | undefined

  AbortSignal.timeout = (ms) => {
    delay = ms
    const controller = new AbortController()
    queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
    return controller.signal
  }
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    })) as typeof globalThis.fetch

  try {
    const outcome = await Promise.race([
      run().then(
        () => "resolved" as const,
        (err) => {
          if (err instanceof DOMException && err.name === "TimeoutError") return "timed-out" as const
          throw err
        },
      ),
      Bun.sleep(50).then(() => "still-pending" as const),
    ])

    expect(outcome).toBe("timed-out")
    expect(delay).toBe(30_000)
  } finally {
    globalThis.fetch = fetch
    AbortSignal.timeout = timeout
  }
}

describe("cloud session export requests", () => {
  test("times out a stalled preview request", async () => {
    await expectStalledFetchToTimeOut(() => fetchCloudSession("token", "session-id"))
  })

  test("times out a stalled import request", async () => {
    await expectStalledFetchToTimeOut(() => fetchCloudSessionForImport("token", "session-id"))
  })
})

describe("cloud session import preparation", () => {
  function sample() {
    return {
      info: {
        id: "ses_cloud",
        slug: "cloud-session",
        projectID: "proj_cloud",
        workspaceID: "wrk_cloud",
        directory: "/cloud/workspace",
        path: "cloud/path",
        parentID: "ses_cloud_parent",
        share: { url: "https://example.com/share" },
        revert: { messageID: "msg_cloud_child", partID: "prt_cloud_compaction" },
        metadata: { source: "cloud" },
        title: "Cloud session",
        version: "7.4.11",
        time: { created: 10, updated: 20, compacting: 30, archived: 40 },
      },
      messages: [
        {
          info: {
            id: "msg_cloud_child",
            sessionID: "ses_cloud",
            parentID: "msg_cloud_parent",
            role: "assistant",
            time: { created: 12 },
            modelID: "test",
            providerID: "test",
            mode: "build",
            agent: "build",
            path: { cwd: "/cloud/workspace", root: "/cloud/workspace" },
            cost: 1,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [
            {
              id: "prt_cloud_tool",
              messageID: "msg_cloud_child",
              sessionID: "ses_cloud",
              type: "tool",
              callID: "call_cloud",
              tool: "read",
              state: {
                status: "completed",
                input: {},
                output: "attached",
                title: "Attachment",
                metadata: {},
                time: { start: 12, end: 13 },
                attachments: [
                  {
                    id: "prt_cloud_attachment",
                    messageID: "msg_cloud_child",
                    sessionID: "ses_cloud",
                    type: "file",
                    mime: "text/plain",
                    filename: "result.txt",
                    url: "data:text/plain,attached",
                  },
                ],
              },
            },
          ],
        },
        {
          info: {
            id: "msg_cloud_parent",
            sessionID: "ses_cloud",
            role: "user",
            time: { created: 11 },
            agent: "build",
            model: { providerID: "test", modelID: "test" },
          },
          parts: [
            {
              id: "prt_cloud_compaction",
              messageID: "msg_cloud_parent",
              sessionID: "ses_cloud",
              type: "compaction",
              auto: true,
              tail_start_id: "msg_cloud_child",
            },
          ],
        },
      ],
    }
  }

  function deps(
    ids = ["msg_local_child", "prt_local_tool", "prt_local_attachment", "msg_local_parent", "prt_local_compaction"],
    target: { workspaceID?: string; path?: string } = { workspaceID: "wrk_local", path: "nested" },
  ) {
    const available = [...ids]
    return {
      Instance: { directory: "/local/workspace", project: { id: "proj_local" } },
      ...target,
      Identifier: {
        descending: () => "ses_local",
        ascending: () => available.shift() ?? "unexpected_id",
      },
    }
  }

  test("remaps references and target context without mutating the export", () => {
    const data = sample()
    const before = structuredClone(data)
    const result = prepareSessionImport(data, deps())

    expect(result.info).toMatchObject({
      id: "ses_local",
      projectID: "proj_local",
      directory: "/local/workspace",
      workspaceID: "wrk_local",
      path: "nested",
      slug: "cloud-session",
      title: "Cloud session",
      version: "7.4.11",
      metadata: { source: "cloud" },
      time: { created: 10, compacting: 30, archived: 40 },
    })
    expect(result.info).not.toHaveProperty("parentID")
    expect(result.info).not.toHaveProperty("share")
    expect(result.info).not.toHaveProperty("revert")
    expect(result.info.time.updated).toBeGreaterThanOrEqual(before.info.time.updated)
    expect(result.messages[0]).toMatchObject({
      id: "msg_local_child",
      session_id: "ses_local",
      data: { id: "msg_local_child", sessionID: "ses_local", parentID: "msg_local_parent" },
    })
    expect(result.parts[0]).toMatchObject({
      id: "prt_local_tool",
      message_id: "msg_local_child",
      session_id: "ses_local",
      data: {
        id: "prt_local_tool",
        messageID: "msg_local_child",
        sessionID: "ses_local",
        state: {
          attachments: [
            {
              id: "prt_local_attachment",
              messageID: "msg_local_child",
              sessionID: "ses_local",
              type: "file",
              mime: "text/plain",
              filename: "result.txt",
              url: "data:text/plain,attached",
            },
          ],
        },
      },
    })
    expect(result.parts[1]).toMatchObject({
      id: "prt_local_compaction",
      message_id: "msg_local_parent",
      session_id: "ses_local",
      data: {
        id: "prt_local_compaction",
        messageID: "msg_local_parent",
        sessionID: "ses_local",
        tail_start_id: "msg_local_child",
      },
    })
    expect(data).toEqual(before)

    const detached = prepareSessionImport(sample(), deps(undefined, {}))
    expect(detached.info).not.toHaveProperty("workspaceID")
    expect(detached.info).not.toHaveProperty("path")
  })

  test("rejects malformed, duplicate, and dangling transcript data", () => {
    const base = sample()
    const first = base.messages[0]!
    const second = base.messages[1]!
    const tool = first.parts[0]!
    const state = tool.state
    const attachment = state.attachments[0]!
    const part = second.parts[0]!
    const invalid = [
      { info: base.info },
      { ...base, messages: [...base.messages, null] },
      { ...base, messages: [first, { ...second, parts: [...second.parts, null] }] },
      { ...base, messages: [first, { ...second, info: { ...second.info, id: first.info.id } }] },
      { ...base, messages: [first, { ...second, parts: [part, { ...part }] }] },
      { ...base, messages: [{ ...first, info: { ...first.info, parentID: "msg_missing" } }, second] },
      { ...base, messages: [first, { ...second, parts: [{ ...part, tail_start_id: "msg_missing" }] }] },
      { ...base, messages: [first, { ...second, parts: [{ ...part, messageID: "msg_missing" }] }] },
      {
        ...base,
        messages: [{ ...first, parts: [{ ...tool, state: { ...state, attachments: [null] } }] }, second],
      },
      {
        ...base,
        messages: [
          {
            ...first,
            parts: [{ ...tool, state: { ...state, attachments: [{ ...attachment, messageID: "msg_missing" }] } }],
          },
          second,
        ],
      },
      {
        ...base,
        messages: [
          {
            ...first,
            parts: [{ ...tool, state: { ...state, attachments: [{ ...attachment, id: tool.id }] } }],
          },
          second,
        ],
      },
      {
        ...base,
        messages: [
          {
            ...first,
            parts: [{ ...tool, state: { ...state, attachments: [attachment, { ...attachment }] } }],
          },
          second,
        ],
      },
    ]

    for (const item of invalid) {
      expect(() => prepareSessionImport(item, deps())).toThrow(SessionImportValidationError)
    }
  })
})
