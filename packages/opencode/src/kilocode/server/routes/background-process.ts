import { BackgroundProcess } from "@/kilocode/background-process"
import { errors } from "@/server/error"
import { NotFoundError } from "@/storage/storage"
import { SessionID } from "@/session/schema"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import z from "zod"

export const BackgroundProcessRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List background processes",
        description: "List tracked background processes for the current instance.",
        operationId: "backgroundProcess.list",
        responses: {
          200: {
            description: "List of background processes",
            content: { "application/json": { schema: resolver(BackgroundProcess.Info.zod.array()) } },
          },
        },
      }),
      async (c) => c.json(await BackgroundProcess.list()),
    )
    .get(
      "/:processID",
      describeRoute({
        summary: "Get background process",
        description: "Get status and retained output for one background process.",
        operationId: "backgroundProcess.get",
        responses: {
          200: {
            description: "Background process info",
            content: { "application/json": { schema: resolver(BackgroundProcess.Info.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ processID: BackgroundProcess.ID.zod })),
      async (c) => {
        const info = await BackgroundProcess.get(c.req.valid("param").processID)
        if (!info) throw new NotFoundError({ message: "Background process not found" })
        return c.json(info)
      },
    )
    .get(
      "/:processID/logs",
      describeRoute({
        summary: "Get background process logs",
        description: "Get the retained output tail for one background process.",
        operationId: "backgroundProcess.logs",
        responses: {
          200: {
            description: "Background process logs",
            content: { "application/json": { schema: resolver(BackgroundProcess.Logs.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ processID: BackgroundProcess.ID.zod })),
      async (c) => {
        const info = await BackgroundProcess.logs(c.req.valid("param").processID)
        if (!info) throw new NotFoundError({ message: "Background process not found" })
        return c.json(info)
      },
    )
    .post(
      "/:processID/stop",
      describeRoute({
        summary: "Stop background process",
        description: "Terminate a background process and its child process tree.",
        operationId: "backgroundProcess.stop",
        responses: {
          200: {
            description: "Stopped background process",
            content: { "application/json": { schema: resolver(BackgroundProcess.Info.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ processID: BackgroundProcess.ID.zod })),
      async (c) => {
        const info = await BackgroundProcess.stop(c.req.valid("param").processID)
        if (!info) throw new NotFoundError({ message: "Background process not found" })
        return c.json(info)
      },
    )
    .post(
      "/:processID/restart",
      describeRoute({
        summary: "Restart background process",
        description: "Stop and restart a background process with its original command.",
        operationId: "backgroundProcess.restart",
        responses: {
          200: {
            description: "Restarted background process",
            content: { "application/json": { schema: resolver(BackgroundProcess.Info.zod) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ processID: BackgroundProcess.ID.zod })),
      async (c) => {
        const info = await BackgroundProcess.restart(c.req.valid("param").processID)
        if (!info) throw new NotFoundError({ message: "Background process not found" })
        return c.json(info)
      },
    )
    .post(
      "/session/:sessionID/stop",
      describeRoute({
        summary: "Stop session background processes",
        description: "Terminate and forget all background processes associated with one session.",
        operationId: "backgroundProcess.stopSession",
        responses: {
          200: {
            description: "Stopped session background processes",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        await BackgroundProcess.stopSession(c.req.valid("param").sessionID)
        return c.json(true)
      },
    ),
)
