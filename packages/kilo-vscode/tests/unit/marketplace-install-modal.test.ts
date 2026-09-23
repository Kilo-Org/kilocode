import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("reports plugin config scopes and actual installed paths", () => fixture("marketplace-install-modal"), 30_000)
