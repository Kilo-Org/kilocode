// kilocode_change - new file
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"
import { SessionNetwork } from "@/session/network"
import { QuestionID } from "@/question/schema"

export const NetworkRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending network waits",
        description: "Get all pending network reconnect requests across all sessions.",
        operationId: "network.list",
        responses: {
          200: {
            description: "List of pending network reconnect requests",
            content: {
              "application/json": {
                schema: resolver(SessionNetwork.Wait.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await SessionNetwork.list()
        return c.json(result)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Resume after network wait",
        description: "Resume a pending session after reconnecting network-dependent services.",
        operationId: "network.reply",
        responses: {
          200: {
            description: "Network wait resumed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: QuestionID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await SessionNetwork.reply({ requestID: params.requestID })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject network resume request",
        description: "Stop a pending session instead of resuming after network reconnect.",
        operationId: "network.reject",
        responses: {
          200: {
            description: "Network wait rejected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: QuestionID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await SessionNetwork.reject({ requestID: params.requestID })
        return c.json(true)
      },
    ),
)
