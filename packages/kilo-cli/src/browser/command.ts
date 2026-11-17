import { Spec } from "@opencode/cli/framework/spec"
import { Argument, Flag } from "effect/cli"

// `kilo browser-smoke`: one-shot harness for the bundled Playwright backend. It boots a Location exactly as the
// server does, so the Kilo plugins register their tools, then runs `browser_navigate` once and prints the result.
// The spike needs it to prove that the tool runs from the compiled binary; the browser command group replaces it.
export const BrowserSmokeCommand = Spec.make("browser-smoke", {
  description: "navigate the bundled browser to a URL and print the page snapshot (spike harness)",
  params: {
    url: Argument.String("url").pipe(Argument.withDescription("URL to navigate to")),
    directory: Flag.String("directory").pipe(
      Flag.withDescription("directory the tool's session runs in"),
      Flag.optional,
    ),
  },
})
