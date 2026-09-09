import assert from "node:assert/strict"
import { createServer } from "node:http"
import { EventEmitter, once } from "node:events"
import { randomUUID } from "node:crypto"

export function sanitize(value) {
  return String(value)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /(["']?(?:authorization|api[_-]?key|password|token|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/g, "$1?[REDACTED]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
}

export async function serve(chars = 6000) {
  const events = new EventEmitter()
  const calls = []
  const blocked = []
  const hosts = []
  const cap = randomUUID()
  const server = createServer(async (req, res) => {
    try {
      if (/^https?:\/\//.test(req.url)) {
        blocked.push({ method: req.method, target: new URL(req.url).origin })
        res.writeHead(403).end("External network disabled by regression fixture")
        return
      }
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 8 * 1024 * 1024) throw new Error("Request exceeds bounded history budget")
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
      if (req.url === "/host-ready") {
        assert.equal(req.headers.authorization, `Bearer ${cap}`)
        hosts.push(body)
        events.emit("host")
        res.end("{}")
        return
      }
      if (req.url === "/v1/models") {
        res.setHeader("Content-Type", "application/json")
        res.end(
          JSON.stringify({ object: "list", data: [{ id: "fixture-model", object: "model", owned_by: "fixture" }] }),
        )
        return
      }
      if (req.url !== "/v1/chat/completions") {
        res
          .writeHead(404, { "Content-Type": "application/json" })
          .end('{"error":{"message":"Fixture endpoint not implemented"}}')
        return
      }
      assert.equal(body.model, "fixture-model", "No provider/model fallback is allowed")
      assert.ok(Array.isArray(body.messages), "OpenAI-compatible messages array is required")
      const last = body.messages.filter((message) => message.role === "user").at(-1)
      const content = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content)
      const turn = content?.match(/RL_TURN_(\d+)/)?.[1]
      const text =
        body.stream && turn
          ? `RL_REPLY_${turn}. Response Lens keeps a stable source number.\n\n${"Synthetic history paragraph: the local model returns deterministic text without tools or external services. ".repeat(Math.ceil(chars / 106)).slice(0, chars)}\n\nRL_END_${turn}.`
          : "RL_EXPLANATION: A stable number identifies the same saved note after a reload."
      // Record counts/roles only, never request bodies, auth headers, or keys.
      calls.push({
        method: req.method,
        path: req.url,
        model: body.model,
        stream: !!body.stream,
        turn,
        bytes: size,
        messages: body.messages.length,
        output: text.length,
      })
      const common = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model: body.model }
      if (!body.stream) {
        res.setHeader("Content-Type", "application/json")
        res.end(
          JSON.stringify({
            ...common,
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
          }),
        )
        return
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
      const send = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        )
      send({ role: "assistant", content: "" })
      for (let offset = 0; offset < text.length; offset += 512) {
        if (!send({ content: text.slice(offset, offset + 512) })) await once(res, "drain")
      }
      send({}, "stop")
      res.end("data: [DONE]\n\n")
    } catch (error) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: { message: sanitize(error.message) } }))
    }
  })
  server.on("connect", (req, socket) => {
    socket.on("error", (error) => blocked.push({ method: "CONNECT-reset", target: error.code || "socket-error" }))
    blocked.push({ method: "CONNECT", target: req.url.split(":")[0] })
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
  })
  server.on("clientError", (error, socket) => {
    blocked.push({ method: "client-error", target: error.code || "socket-error" })
    socket.destroy()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    cap,
    calls,
    blocked,
    hosts,
    async host(count = 1, timeout = 60000) {
      const signal = AbortSignal.timeout(timeout)
      while (hosts.length < count) await once(events, "host", { signal })
      return hosts.at(-1)
    },
    async command(body = {}) {
      const host = hosts.at(-1)
      assert.ok(host, "Extension-host helper has not announced readiness")
      const response = await fetch(`http://127.0.0.1:${host.port}`, {
        method: "POST",
        headers: { authorization: `Bearer ${cap}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      const result = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result))
      return result
    },
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
