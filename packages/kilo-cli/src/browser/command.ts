import { Spec } from "@opencode/cli/framework/spec"
import { Flag } from "effect/cli"

// `kilo browser`: the browser the bundled Playwright backend drives. The build is the Chromium that the CLI's own
// playwright-core pins, downloaded into the Kilo data dir, so the backend finds it without a system Chrome or Edge.
export const BrowserCommand = Spec.make("browser", {
  description: "the browser the CLI drives",
  commands: [
    Spec.make("install-chromium", {
      description: "download the Chromium build that matches this CLI into the Kilo data dir",
      params: {
        force: Flag.Boolean("force").pipe(
          Flag.withDescription("download again even when the matching build is already installed"),
          Flag.withDefault(false),
        ),
      },
    }),
  ],
})
