import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "renders companion skill disclosures, removal notices, and installed paths",
  () => fixture("marketplace-install-modal"),
  30_000,
)
