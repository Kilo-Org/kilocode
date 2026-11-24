import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("settles the profile account selector from the correlated result message", () => fixture("profile-view"), 30_000)
