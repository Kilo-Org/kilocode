import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("tracks the account switch lifecycle from the correlated result message", () => fixture("account-switcher"), 30_000)
