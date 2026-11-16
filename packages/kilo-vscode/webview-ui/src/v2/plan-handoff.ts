// The plan follow-up creates the Code session and asks every client to show it (`tui.session.select`). The event names
// only the new session, and the sidebar and the Agent Manager both listen. The webview that shows the plan session
// takes it: it watches the follow-up forms of its sessions and records a "Start new session" reply, wherever the reply
// came from (its question dock, another client, or the agent_manager tool). The server creates the session right
// after the reply.
import { createEffect, onCleanup } from "solid-js"

const WINDOW = 10_000
// A form can leave the store without a reply or cancel event (a deleted session, a resync), so only the newest forms
// are remembered.
const FORMS = 50
const NEW_SESSION = "plan.followup.answer.newSession"

const answers = new Map<string, number>()

type Form = { id: string; sessionID: string; metadata?: { [key: string]: unknown } }
type Replied = { data: { id: string; answer: { [key: string]: unknown } } }

/** Records that a plan of this webview in `directory` was answered with a new session. */
export function recordAnswer(directory: string, now = Date.now()) {
  answers.set(directory, now)
}

/** Whether this webview shows the handoff of `directory`. Consumes the answer, so one answer opens one session. */
export function takesHandoff(directory: string, now = Date.now()) {
  const time = answers.get(directory)
  answers.delete(directory)
  return time !== undefined && now - time <= WINDOW
}

/** Whether a reply to `form` picks the plan follow-up's "Start new session" option. */
export function startsPlanSession(form: Pick<Form, "metadata">, answer: Replied["data"]["answer"]) {
  const options = optionHints(form.metadata)
  return Object.entries(answer).some(([key, value]) =>
    (Array.isArray(value) ? value : [value]).some(
      (label) => typeof label === "string" && options?.[key]?.[label]?.labelKey === NEW_SESSION,
    ),
  )
}

/**
 * Watches the pending forms of the sessions this webview shows in `directory` and records a plan follow-up answered
 * with a new session. The store drops a form when it is replied, so the forms are remembered until their reply: the
 * ones the store loaded, and the ones created while the webview runs.
 */
export function trackPlanAnswers(input: {
  directory: string
  sessions: () => string[]
  forms: (sessionID: string) => Form[] | undefined
  created: (handler: (event: { data: { form: Form } }) => void) => () => void
  replied: (handler: (event: Replied) => void) => () => void
  cancelled: (handler: (event: { data: { id: string } }) => void) => () => void
}) {
  const known = new Map<string, Form>()
  const remember = (form: Form) => {
    if (known.has(form.id) || !optionHints(form.metadata)) return
    known.set(form.id, form)
    if (known.size > FORMS) known.delete(known.keys().next().value!)
  }
  createEffect(() => {
    for (const id of input.sessions()) for (const form of input.forms(id) ?? []) remember(form)
  })
  onCleanup(
    input.created((event) => {
      if (input.sessions().includes(event.data.form.sessionID)) remember(event.data.form)
    }),
  )
  onCleanup(
    input.replied((event) => {
      const form = known.get(event.data.id)
      known.delete(event.data.id)
      if (form && startsPlanSession(form, event.data.answer)) recordAnswer(input.directory)
    }),
  )
  onCleanup(input.cancelled((event) => known.delete(event.data.id)))
}

type Hints = { [key: string]: { [label: string]: { labelKey?: unknown } } }

function optionHints(metadata: Form["metadata"]): Hints | undefined {
  const kilocode = metadata?.["kilocode"]
  if (!kilocode || typeof kilocode !== "object" || !("options" in kilocode)) return undefined
  const options = kilocode.options
  return options && typeof options === "object" ? (options as Hints) : undefined
}
