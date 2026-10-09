import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("routes the send-all split button to chat or GitHub", () => fixture("send-all-button"), 30_000)
