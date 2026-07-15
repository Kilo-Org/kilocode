import { Reference } from "@opencode-ai/core/reference"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../groups/location"
import { reconcile } from "../kilocode/reference-reconciler" // kilocode_change

export const ReferenceHandler = HttpApiBuilder.group(Api, "server.reference", (handlers) =>
  handlers.handle("reference.list", () =>
    response(reconcile(Reference.Service.use((reference) => reference.list()))), // kilocode_change
  ),
)
