import { expect, test } from "bun:test"
import { GoalInstructions } from "@/kilocode/session/goal/instructions"
import backgroundProcess from "@/kilocode/tool/background-process.txt"
import cancelWakeup from "@/kilocode/tool/cancel-wakeup.txt"
import cronCreate from "@/kilocode/tool/cron-create.txt"
import cronDelete from "@/kilocode/tool/cron-delete.txt"
import cronList from "@/kilocode/tool/cron-list.txt"
import scheduleWakeup from "@/kilocode/tool/schedule-wakeup.txt"

// A scheduled wait must read as a normal goal action that suspends the goal, not
// as a blocker that ends it. These are the model-facing texts that say so.
const SUSPENDS = /suspend/i
const NOT_BLOCKER = /not a blocker|not report a time-based wait as blocked|report blocked only when no scheduled wait/i
const HORIZON = /7-day horizon/i

const goalPrompt = GoalInstructions.prompt("Improve the validation workflow")

const descriptions = {
  schedule_wakeup: scheduleWakeup,
  cancel_wakeup: cancelWakeup,
  cron_create: cronCreate,
  cron_list: cronList,
  cron_delete: cronDelete,
  background_process: backgroundProcess,
}

test("a wait-for-deploy objective is a timed goal", () => {
  expect(GoalInstructions.timed("Wait for the deploy to finish, then verify it")).toBe(true)
  expect(GoalInstructions.timed("wait for the build to complete")).toBe(true)
  expect(GoalInstructions.timed("Improve the validation workflow")).toBe(false)
})

test("every goal and timing description names the session goal", () => {
  expect(GoalInstructions.help).toMatch(/goal/i)
  expect(goalPrompt).toMatch(/goal/i)
  for (const text of Object.values(descriptions)) expect(text).toMatch(/goal/i)
})

test("every timing description says a scheduled wait suspends the goal", () => {
  for (const [name, text] of Object.entries(descriptions)) expect(text, name).toMatch(SUSPENDS)
})

test("the goal instructions say a time wait suspends the goal and is not a blocker", () => {
  expect(GoalInstructions.help).toMatch(SUSPENDS)
  expect(GoalInstructions.help).toMatch(NOT_BLOCKER)
  expect(goalPrompt).toMatch(SUSPENDS)
  expect(goalPrompt).toMatch(NOT_BLOCKER)
})

test("the goal instructions show a waiting goal as waiting", () => {
  expect(GoalInstructions.help).toMatch(/shows as waiting/i)
  expect(goalPrompt).toMatch(/shows as waiting/i)
})

test("the goal prompt tells the model to schedule a wait instead of exploring", () => {
  expect(GoalInstructions.help).toMatch(/first tool call must be schedule_wakeup/)
  expect(GoalInstructions.help).toMatch(/Do not explore the repository, search for a deploy, or poll instead of scheduling/)
  expect(GoalInstructions.help).toMatch(/Do not report blocked because no deploy is visible/)
  expect(goalPrompt).toMatch(/first tool call must be schedule_wakeup/)
  expect(goalPrompt).toMatch(/Do not explore the repository, search for a deploy, or poll instead of scheduling/)
  expect(goalPrompt).toMatch(/Do not report blocked because no deploy is visible/)
  expect(goalPrompt.indexOf("first tool call must be")).toBeLessThan(goalPrompt.indexOf("Continue working toward this session goal"))
})

test("timing descriptions tell the model not to explore or bash-sleep a goal wait", () => {
  expect(scheduleWakeup).toMatch(/Do not explore the repository, search for a deploy, or poll with bash instead of scheduling/)
  expect(cronCreate).toMatch(/Do not explore the repository, search for a deploy, or poll with bash first/)
  expect(backgroundProcess).toMatch(/time-based wait must use `schedule_wakeup` or `cron_create`/)
  expect(backgroundProcess).toMatch(/blocking shell sleep is progress/)
})

test("the goal instructions state the wakeup and cron caps and the 7-day horizon", () => {
  for (const text of [GoalInstructions.help, goalPrompt]) {
    expect(text).toMatch(/MAX_PER_SESSION/)
    expect(text).toMatch(/MAX_CRON_PER_SESSION/)
    expect(text).toMatch(HORIZON)
  }
})

test("the goal instructions say finishing, blocking, pausing or clearing cancels armed timers", () => {
  for (const text of [GoalInstructions.help, goalPrompt])
    expect(text).toMatch(/cancels its armed wakeups and cron tasks/i)
})

test("schedule_wakeup says a one-shot wait is normal progress, not a blocker", () => {
  expect(scheduleWakeup).toMatch(SUSPENDS)
  expect(scheduleWakeup).toMatch(NOT_BLOCKER)
  expect(scheduleWakeup).toMatch(HORIZON)
})

test("cron_create says each fire suspends the goal and a longer wait is clamped", () => {
  expect(cronCreate).toMatch(SUSPENDS)
  expect(cronCreate).toMatch(/recurring task/i)
  expect(cronCreate).toMatch(NOT_BLOCKER)
  expect(cronCreate).toMatch(HORIZON)
})

// cron_create only clamps a one-shot `when`/`delay` to the horizon; a recurring
// `cron` schedule whose next fire falls past the 7-day expiry is rejected. It
// does not echo the wakeup `clampNotice`, so the text must not claim it does.
test("cron_create scopes the horizon clamp to one-shot waits and rejects a late recurring fire", () => {
  expect(cronCreate).toMatch(/one-shot `when` or `delay` wait longer than the 7-day horizon is clamped/i)
  expect(cronCreate).toMatch(/recurring `cron` schedule whose next fire falls past the task's 7-day expiry is rejected/i)
  expect(cronCreate).not.toMatch(/tool result says the requested time was pulled back/i)
})

test("cron_list says the goal's own tasks are cancelled with the goal", () => {
  expect(cronList).toMatch(SUSPENDS)
  expect(cronList).toMatch(/goal's own cron tasks/i)
  expect(cronList).toMatch(/cancelled when it completes, blocks, or is cleared/i)
})

test("cron_delete says deleting an awaited task resumes or settles the goal", () => {
  expect(cronDelete).toMatch(SUSPENDS)
  expect(cronDelete).toMatch(/resumes the goal/i)
  expect(cronDelete).toMatch(/reason/i)
})

test("cancel_wakeup says cancelling an awaited wakeup resumes or settles the goal", () => {
  expect(cancelWakeup).toMatch(SUSPENDS)
  expect(cancelWakeup).toMatch(/resumes the goal/i)
  expect(cancelWakeup).toMatch(/reason/i)
})

test("background_process says monitor blocks the goal turn and start suspends the goal", () => {
  expect(backgroundProcess).toMatch(/blocks the goal turn/i)
  expect(backgroundProcess).toMatch(/does not spin/i)
  expect(backgroundProcess).toMatch(SUSPENDS)
})
