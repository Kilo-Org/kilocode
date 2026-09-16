import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "replies to canonical inline diff comments and keeps historical threads read-only",
  () => fixture("diff-comment-render"),
  30_000,
)
