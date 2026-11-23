import { test } from "bun:test"
import { fixture } from "../fixtures/run"

test(
  "permission dock shows format characters escaped on every surface",
  () => fixture("permission-dock-display"),
  30_000,
)
