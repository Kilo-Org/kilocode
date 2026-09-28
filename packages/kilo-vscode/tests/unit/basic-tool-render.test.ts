import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("keeps a collapsed tool body lazy and its trigger node stable", () => fixture("basic-tool-render"), 30_000)
