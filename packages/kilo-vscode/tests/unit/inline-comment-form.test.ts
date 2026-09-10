import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "keeps compact shared comment actions, keyboard behavior, and publication safety",
  () => fixture("inline-comment-form"),
  30_000,
)
