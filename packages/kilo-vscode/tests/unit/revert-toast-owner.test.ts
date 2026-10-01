import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("shows one revert failure toast per webview when a second session provider is nested", () =>
  fixture("revert-toast-owner"))
