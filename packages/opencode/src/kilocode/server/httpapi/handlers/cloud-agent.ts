import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"

export const cloudAgentHandlers = HttpApiBuilder.group(InstanceHttpApi, "cloudAgent", (handlers) =>
  handlers.handleRaw("systemEvents", () =>
    Effect.fail(new InvalidRequestError({ message: "A hosted attachment is required for Cloud Agent events" })),
  ),
)
