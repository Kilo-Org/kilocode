import { test } from "bun:test"
import { fixture } from "../fixtures/run"

test("permission dock renders the full pending input", () => fixture("permission-dock-input"), 30_000)
