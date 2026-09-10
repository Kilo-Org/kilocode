import { expect } from "bun:test"
import { Effect } from "effect"
import { appHost } from "./app-host"
import { createPermissionMethods } from "../src/backend/permissions"
import { createQuestionMethods } from "../src/backend/questions"
import { createWorkspaceMethods } from "../src/backend/workspace"
import { viewEvents } from "../src/backend/events"
import { createSessionMethods } from "../src/backend/session"
import { messageViews } from "../src/backend/projection"
import { createMcpMethods } from "../src/backend/mcp"
import { createUsageMethods } from "../src/backend/usage"
import { createPtyMethods } from "../src/backend/pty"
import { TerminalConnection } from "../src/backend/terminal-connection"
import { WebSocket } from "ws"
import path from "node:path"
import { SessionAbort } from "../src/kilo-provider/abort"

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.promise(() => Bun.write("adapter-search.txt", "local search acceptance"))
      yield* Effect.promise(() =>
        Bun.write(
          "kilo.jsonc",
          JSON.stringify({
            commands: { "adapter-command": { template: "Extension command: $ARGUMENTS" } },
          }),
        ),
      )
      const host = yield* appHost
      const session = createSessionMethods(host.verified.client, process.cwd())
      const permission = createPermissionMethods(host.verified.client, process.cwd())
      const question = createQuestionMethods(host.verified.client, process.cwd())
      const workspace = createWorkspaceMethods(host.verified.client, process.cwd())
      const mcp = createMcpMethods(host.verified.client, process.cwd())
      const usage = createUsageMethods(host.verified.client, process.cwd())
      yield* Effect.promise(async () => {
        const controller = new AbortController()
        const streamed: string[] = []
        const approved: string[] = []
        const ready = Promise.withResolvers<void>()
        const questionAnswered = Promise.withResolvers<void>()
        const terminalDeleted = Promise.withResolvers<string>()
        const removed = new Set<string>()
        const lifecycle: string[] = []
        const idle = Promise.withResolvers<void>()
        const stopping = new Set<string>()
        const blocked = Promise.withResolvers<void>()
        const interrupted = Promise.withResolvers<void>()
        const stream = (async () => {
          for await (const event of viewEvents(host.verified.client, process.cwd(), controller.signal)) {
            if (event.payload.type === "server.connected") ready.resolve()
            if (event.payload.type === "session.status") {
              lifecycle.push(event.payload.properties.status.type)
              if (event.payload.properties.status.type === "idle") idle.resolve()
            }
            if (event.payload.type === "session.turn.close") {
              lifecycle.push(event.payload.properties.reason)
              if (event.payload.properties.reason === "interrupted") interrupted.resolve()
            }
            if (event.payload.type === "pty.deleted") terminalDeleted.resolve(event.payload.properties.id)
            if (event.payload.type === "message.removed") removed.add(event.payload.properties.messageID)
            if (event.payload.type === "question.replied") {
              expect(event.payload.properties.answers).toEqual([["Friendly label"], ["Second", "First"]])
              questionAnswered.resolve()
            }
            if (event.payload.type === "permission.asked") {
              const request = event.payload.properties
              if (stopping.has(request.sessionID)) {
                blocked.resolve()
                continue
              }
              expect(request.permission).toBe("shell")
              expect(request.tool?.callID).toBeDefined()
              const pending = await permission.list({}, { throwOnError: true })
              expect(pending.data.some((item) => item.id === request.id)).toBe(true)
              await permission.reply({ requestID: request.id, reply: "once" }, { throwOnError: true })
              approved.push(request.id)
            }
            if (event.payload.type === "message.part.updated" && event.payload.properties.part.type === "text")
              streamed.push(event.payload.properties.part.text)
          }
        })()
        await ready.promise
        expect(
          (await workspace.find.files({ query: "adapter-search", type: "file" }, { throwOnError: true })).data,
        ).toContain("adapter-search.txt")
        expect((await workspace.project.current({}, { throwOnError: true })).data.worktree).toBe(process.cwd())
        const created = await session.create(
          { title: "Existing Kilo UI", agent: "build", model: { providerID: "fixture", id: "chat" } },
          { throwOnError: true },
        )
        expect(created.data.directory).toBe(process.cwd())
        expect(created.data.title).toBe("Existing Kilo UI")
        const sent = await session.promptAsync(
          {
            sessionID: created.data.id,
            agent: "build",
            model: { providerID: "fixture", modelID: "chat" },
            parts: [
              { type: "text", text: "Ported UI prompt @build" },
              { type: "agent", name: "build", source: { value: "@build", start: 16, end: 22 } },
            ],
          },
          { throwOnError: true },
        )
        expect(sent.error).toBeUndefined()
        await host.verified.client.session.wait({ sessionID: created.data.id })
        await idle.promise
        expect(lifecycle).toEqual(["busy", "completed", "idle"])
        // Successful native interruption must clear stale UI state even without a recorded busy event.
        expect(await new SessionAbort().stop({ session }, created.data.id, process.cwd())).toBe(true)
        const messages = await session.messages({ sessionID: created.data.id }, { throwOnError: true })
        expect(messages.data.map((entry) => entry.info.role)).toEqual(["user", "assistant"])
        expect(messages.data[0].parts[0]).toMatchObject({ type: "text", text: "Ported UI prompt @build" })
        expect(messages.data[0].parts[1]).toMatchObject({
          type: "agent",
          name: "build",
          source: { value: "@build", start: 16, end: 22 },
        })
        expect(messages.data[1].parts[0]).toMatchObject({ type: "text", text: "Browser fixture reply" })
        const consumed = await usage.sessionModelUsage({ sessionID: created.data.id }, { throwOnError: true })
        expect(consumed.data.sessionIDs.some((id) => id === created.data.id)).toBe(true)
        expect(consumed.data.totals.steps).toBe(1)
        expect(consumed.data.models).toContainEqual(
          expect.objectContaining({ providerID: "fixture", modelID: "chat", steps: 1 }),
        )
        expect(messages.data[1].info).toMatchObject({
          parentID: messages.data[0].info.id,
          providerID: "fixture",
          modelID: "chat",
        })
        const renamed = await session.update(
          { sessionID: created.data.id, title: "Renamed existing UI" },
          { throwOnError: true },
        )
        expect(renamed.data.title).toBe("Renamed existing UI")
        const fork = await session.fork({ sessionID: created.data.id }, { throwOnError: true })
        expect(fork.data.parentID).toBeUndefined()
        expect((await host.verified.client.session.get({ sessionID: fork.data.id })).fork?.sessionID).toBe(
          created.data.id,
        )
        const listed = await session.list({ roots: true }, { throwOnError: true })
        expect(listed.data.some((item) => item.id === fork.data.id)).toBe(true)
        await session.delete({ sessionID: fork.data.id }, { throwOnError: true })
        const missing = await session.get({ sessionID: fork.data.id })
        expect(missing.error).toBeDefined()
        await expect(session.get({ sessionID: fork.data.id }, { throwOnError: true })).rejects.toBeDefined()
        await session.promptAsync(
          { sessionID: created.data.id, parts: [{ type: "text", text: "Exercise browser permission" }] },
          { throwOnError: true },
        )
        await host.verified.client.session.wait({ sessionID: created.data.id })
        expect(approved).toHaveLength(1)
        const completed = await session.messages({ sessionID: created.data.id }, { throwOnError: true })
        const firstPage = await session.page({ sessionID: created.data.id, limit: 1 }, { throwOnError: true })
        let before = firstPage.data.cursor
        let pagedIDs = firstPage.data.items.map((row) => row.info.id)
        while (before) {
          const page = await session.page({ sessionID: created.data.id, limit: 1, before }, { throwOnError: true })
          pagedIDs = [...page.data.items.map((row) => row.info.id), ...pagedIDs]
          before = page.data.cursor
        }
        expect(pagedIDs).toEqual(completed.data.map((row) => row.info.id))
        expect(
          completed.data
            .flatMap((entry) => entry.parts)
            .some((part) => part.type === "tool" && part.state.status === "completed"),
        ).toBe(true)
        expect(host.requests).toHaveLength(3)
        const nativeHistory = await host.verified.client.message.list({ sessionID: created.data.id, order: "asc" })
        const assistant = nativeHistory.data.find((message) => message.type === "assistant")
        if (!assistant || assistant.type !== "assistant") throw new Error("Expected the real assistant message")
        const projected = messageViews(await host.verified.client.session.get({ sessionID: created.data.id }), [
          {
            ...assistant,
            content: [
              {
                type: "tool",
                id: "attachment-tool",
                name: "read",
                time: { created: assistant.time.created },
                state: {
                  status: "completed",
                  input: { path: "image.png" },
                  metadata: { title: "Image" },
                  content: [
                    { type: "text", text: "Loaded image" },
                    { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "image.png" },
                  ],
                },
              },
            ],
          },
        ])
        expect(projected[0].parts[0]).toMatchObject({
          type: "tool",
          state: {
            output: "Loaded image",
            metadata: { title: "Image" },
            attachments: [{ filename: "image.png", mime: "image/png", url: "data:image/png;base64,aGVsbG8=" }],
          },
        })
        const form = await host.verified.client.form.create({
          sessionID: created.data.id,
          title: "Existing question card",
          fields: [
            {
              type: "string",
              key: "choice",
              title: "Choose",
              options: [{ value: "stored-value", label: "Friendly label" }],
              required: true,
            },
            {
              type: "multiselect",
              key: "many",
              options: [
                { value: "one", label: "First" },
                { value: "two", label: "Second" },
              ],
            },
          ],
        })
        const pendingQuestions = await question.list({}, { throwOnError: true })
        expect(pendingQuestions.data.find((entry) => entry.id === form.id)?.questions[0].options[0].label).toBe(
          "Friendly label",
        )
        await expect(question.reply({ requestID: form.id, answers: [] }, { throwOnError: true })).rejects.toThrow(
          "Answer count",
        )
        await question.reply(
          { requestID: form.id, answers: [["Friendly label"], ["Second", "First"]] },
          { throwOnError: true },
        )
        expect(await host.verified.client.form.state({ sessionID: created.data.id, formID: form.id })).toEqual({
          status: "answered",
          answer: { choice: "stored-value", many: ["two", "one"] },
        })
        await questionAnswered.promise
        const dismissed = await host.verified.client.form.create({
          sessionID: created.data.id,
          title: "Dismiss",
          fields: [{ type: "string", key: "answer" }],
        })
        await question.reject({ requestID: dismissed.id }, { throwOnError: true })
        expect(await host.verified.client.form.state({ sessionID: created.data.id, formID: dismissed.id })).toEqual({
          status: "cancelled",
        })
        await expect(
          session.revert(
            { sessionID: created.data.id, messageID: messages.data[0].info.id, partID: "part" },
            { throwOnError: true },
          ),
        ).rejects.toThrow("whole messages")
        const staged = await session.revert(
          { sessionID: created.data.id, messageID: messages.data[0].info.id },
          { throwOnError: true },
        )
        expect(staged.data.revert?.messageID).toBe(messages.data[0].info.id)
        const restored = await session.unrevert({ sessionID: created.data.id }, { throwOnError: true })
        expect(restored.data.revert).toBeUndefined()
        expect(
          (
            await mcp.add(
              {
                name: "extension-fixture",
                config: {
                  type: "local",
                  command: [process.execPath, path.join(import.meta.dir, "backend-mcp-server.ts")],
                  enabled: false,
                  timeout: 3000,
                },
              },
              { throwOnError: true },
            )
          ).data["extension-fixture"],
        ).toEqual({ status: "disabled" })
        expect(
          (await mcp.connect({ name: "extension-fixture" }, { throwOnError: true })).data["extension-fixture"],
        ).toEqual({ status: "connected" })
        expect(
          (await mcp.disconnect({ name: "extension-fixture" }, { throwOnError: true })).data["extension-fixture"],
        ).toEqual({ status: "disabled" })
        await mcp.remove({ name: "extension-fixture" }, { throwOnError: true })
        expect((await mcp.status({}, { throwOnError: true })).data["extension-fixture"]).toBeUndefined()
        const commandSession = await session.create({ agent: "build" }, { throwOnError: true })
        await session.command(
          {
            sessionID: commandSession.data.id,
            command: "adapter-command",
            arguments: "original slash workflow",
            model: "fixture/chat",
            parts: [
              {
                type: "file",
                mime: "text/plain",
                filename: "command.txt",
                url: "data:text/plain;base64,Y29tbWFuZCBhdHRhY2htZW50",
              },
            ],
          },
          { throwOnError: true },
        )
        await host.verified.client.session.wait({ sessionID: commandSession.data.id })
        const commandHistory = await session.messages({ sessionID: commandSession.data.id }, { throwOnError: true })
        expect(commandHistory.data[0].parts).toContainEqual(
          expect.objectContaining({ type: "text", text: "Extension command: original slash workflow" }),
        )
        expect(commandHistory.data[0].parts).toContainEqual(
          expect.objectContaining({ type: "file", filename: "command.txt" }),
        )
        expect((await host.verified.client.session.get({ sessionID: commandSession.data.id })).model).toMatchObject({
          providerID: "fixture",
          id: "chat",
        })
        await session.revert(
          { sessionID: commandSession.data.id, messageID: commandHistory.data[0].info.id },
          { throwOnError: true },
        )
        await session.promptAsync(
          { sessionID: commandSession.data.id, parts: [{ type: "text", text: "Replacement after revert" }] },
          { throwOnError: true },
        )
        await host.verified.client.session.wait({ sessionID: commandSession.data.id })
        const replaced = await session.messages({ sessionID: commandSession.data.id }, { throwOnError: true })
        expect(replaced.data.map((row) => row.info.id)).not.toContain(commandHistory.data[0].info.id)
        const pty = createPtyMethods(host.verified.client, process.cwd())
        const terminal = await pty.create({ cwd: process.cwd(), title: "Original terminal" }, { throwOnError: true })
        const relay = new TerminalConnection({
          assets: import.meta.dir,
          serverUrl: host.server.url,
          serverPassword: host.server.auth.password,
        })
        const origin = "https://original-panel.vscode-webview.net"
        relay.register("panel", origin)
        try {
          const address = await relay.connect({ pty }, terminal.data.id, process.cwd())
          expect(address).not.toContain("auth_token")
          expect(address).not.toContain(host.server.auth.password)
          const socket = new WebSocket(address, { headers: { origin } })
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Original terminal relay echo timed out")), 5000)
              socket.on("error", (error) => {
                clearTimeout(timer)
                reject(error)
              })
              socket.on("open", () => socket.send("echo original-terminal-relay\n"))
              socket.on("message", (data) => {
                if (!data.toString().includes("original-terminal-relay")) return
                clearTimeout(timer)
                resolve()
              })
            })
          } finally {
            socket.close()
          }
          const fresh = await relay.connect({ pty }, terminal.data.id, process.cwd())
          expect(new URL(fresh).searchParams.get("ticket")).not.toBe(new URL(address).searchParams.get("ticket"))
          relay.register("panel")
          const refused = new WebSocket(fresh, { headers: { origin } })
          await new Promise<void>((resolve, reject) => {
            refused.on("error", () => resolve())
            refused.once("open", () => {
              refused.close()
              reject(new Error("Disposed panel remained authorized"))
            })
          })
        } finally {
          await relay.close()
          await pty.remove({ ptyID: terminal.data.id }, { throwOnError: true })
          expect(await terminalDeleted.promise).toBe(terminal.data.id)
        }
        const stopTarget = await session.create(
          { agent: "build", model: { providerID: "fixture", id: "chat" } },
          { throwOnError: true },
        )
        stopping.add(stopTarget.data.id)
        await session.promptAsync(
          { sessionID: stopTarget.data.id, parts: [{ type: "text", text: "Exercise browser permission" }] },
          { throwOnError: true },
        )
        await blocked.promise
        expect(Object.keys(await host.verified.client.session.active())).toContain(stopTarget.data.id)
        expect(await new SessionAbort().stop({ session }, stopTarget.data.id, process.cwd())).toBe(true)
        await interrupted.promise
        await host.verified.client.session.wait({ sessionID: stopTarget.data.id })
        expect(Object.keys(await host.verified.client.session.active())).not.toContain(stopTarget.data.id)
        controller.abort()
        await stream
        expect(removed.has(commandHistory.data[0].info.id)).toBe(true)
        expect(streamed).toContain("Browser fixture reply")
        console.log("EXISTING_UI_SESSION_PASS")
      })
    }),
  ),
)
