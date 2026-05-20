import { Layer } from "effect"

import { commitMessageHandlers } from "./handlers/commit-message"
import { enhancePromptHandlers } from "./handlers/enhance-prompt"
import { indexingHandlers } from "./handlers/indexing"
import { kiloGatewayHandlers } from "./handlers/kilo-gateway"
import { kilocodeHandlers } from "./handlers/kilocode"
import { networkHandlers } from "./handlers/network"
import { remoteHandlers } from "./handlers/remote"
import { sessionImportHandlers } from "./handlers/session-import"
import { suggestionHandlers } from "./handlers/suggestion"
import { telemetryHandlers } from "./handlers/telemetry"

export const provide = Layer.provide([
  commitMessageHandlers,
  enhancePromptHandlers,
  indexingHandlers,
  kiloGatewayHandlers,
  kilocodeHandlers,
  networkHandlers,
  remoteHandlers,
  sessionImportHandlers,
  suggestionHandlers,
  telemetryHandlers,
])
