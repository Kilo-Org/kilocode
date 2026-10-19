import { test } from "bun:test"
import { fixture } from "../fixtures/run"

test(
  "a hook ask shows the escaped reason and never saves rules, even ones toggled on an earlier request",
  () => fixture("permission-dock-hook"),
  30_000,
)
