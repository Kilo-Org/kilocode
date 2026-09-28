import { test } from "bun:test"
import { fixture } from "../fixtures/run"

test("permission responses save only explicitly selected rules", () => fixture("permission-dock-rules"), 30_000)
