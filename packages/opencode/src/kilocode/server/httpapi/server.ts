import { Layer } from "effect"
import { FetchHttpClient, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import { CorsConfig, isAllowedCorsOrigin, type CorsOptions } from "@/server/cors"
import { compressionLayer } from "@/server/routes/instance/httpapi/middleware/compression"
import { corsVaryFix } from "@/server/routes/instance/httpapi/middleware/cors-vary"
import { errorLayer } from "@/server/routes/instance/httpapi/middleware/error"
import { fenceLayer } from "@/server/routes/instance/httpapi/middleware/fence"
import * as AnacondaDesktop from "@/kilocode/anaconda-desktop/service"

import { agentBuilderHandlers } from "./handlers/agent-builder"
import { anacondaDesktopHandlers } from "./handlers/anaconda-desktop"
import { backgroundProcessHandlers } from "./handlers/background-process"
import { branchNameHandlers } from "./handlers/branch-name"
import { commitMessageHandlers } from "./handlers/commit-message"
import { configConsoleHandlers } from "./handlers/config-console"
import { enhancePromptHandlers } from "./handlers/enhance-prompt"
import { indexingHandlers } from "./handlers/indexing"
import { interactiveTerminalHandlers } from "./handlers/interactive-terminal"
import { kiloGatewayHandlers } from "./handlers/kilo-gateway"
import { kilocodeHandlers } from "./handlers/kilocode"
import { networkHandlers } from "./handlers/network"
import { remoteHandlers } from "./handlers/remote"
import { sandboxHandlers } from "./handlers/sandbox"
import { sessionImportHandlers } from "./handlers/session-import"
import { suggestionHandlers } from "./handlers/suggestion"
import { telemetryHandlers } from "./handlers/telemetry"

export const provide = Layer.provide([
  agentBuilderHandlers,
  anacondaDesktopHandlers.pipe(Layer.provide(AnacondaDesktop.liveLayer)),
  backgroundProcessHandlers,
  branchNameHandlers,
  commitMessageHandlers,
  configConsoleHandlers,
  enhancePromptHandlers,
  indexingHandlers,
  interactiveTerminalHandlers,
  kiloGatewayHandlers,
  kilocodeHandlers,
  networkHandlers,
  remoteHandlers,
  sandboxHandlers,
  sessionImportHandlers,
  suggestionHandlers,
  telemetryHandlers,
])

export function provideListener(opts?: CorsOptions) {
  const cors = HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, opts),
      maxAge: 86_400,
    }),
    { global: true },
  )
  return Layer.provide([
    errorLayer,
    compressionLayer,
    corsVaryFix,
    fenceLayer,
    cors,
    FetchHttpClient.layer,
    HttpServer.layerServices,
    Layer.succeed(CorsConfig)(opts),
  ])
}
