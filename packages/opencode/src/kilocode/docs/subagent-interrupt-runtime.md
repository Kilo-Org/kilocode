# Subagent Interrupt Runtime Verification

Purpose: capture evidence for the foreground-subagent interrupt fix (commit
52311cd0b8, `fix(cli): allow stopping foreground child sessions`) on the next
naturally occurring foreground-subagent hang. No commit, no push, no new
productivity feature. All evidence is read from on-disk sources so it survives a
TUI restart.

## Evidence sources (persist across restart)

- Runtime logs (rotating file stream, INFO level by default):
  `S:\KILO-CLEAN-SOURCE\profile\data\kilo\log\*.log` and the `.log-history`
  subdir. The `session.prompt` logger emits, when abort is handled:
  `... service=session.prompt cancel sessionID=<id>`
  This line is written by `SessionPrompt.cancel`, the backend handler for
  `POST /:sessionID/abort`.

- Session DB (SQLite): `S:\KILO-CLEAN-SOURCE\profile\data\kilo\kilo.db`,
  table `sessions`. Relevant columns: `id`, `parent_id`, `title`,
  `model` (format `provider/model`), `status`, and agent info. Persists
  across restarts.

- child `task_id` == child session id. The Task tool prints
  `task_id: <session.id>`; resuming passes that same id and the tool reads the
  existing session instead of creating a new one (see `src/tool/task.ts`).

- NOTE: there is NO `SessionRunState` module. Cancellation is
  `SessionPrompt.cancel(sessionID)`, which calls `match.abort.abort()` and sets
  the session status to `idle`. Treat "SessionRunState.cancel ran" as equivalent
  to "SessionPrompt.cancel ran / abort controller fired".

## Procedure

### During the hang (Sean's only action)
Press `Escape` twice while focused inside the child / subagent (foreground)
view. Do nothing else. The double-press triggers the `session_interrupt`
keybind; the fix routes the hidden child prompt's interrupt to
`sdk.client.session.abort({ sessionID })` for the child session.

### After the hang resolves (collect from disk)
1. Record the wall-clock time of the keypress (abort moment).
2. Copy the active log file + `.log-history` from the log dir to a working copy.
3. Grep the log for `cancel sessionID=` to find which child session id was
   aborted and the timestamp.
4. Query the `sessions` row for that id from `kilo.db`.
5. Record `git status` in the working repo (before/after comparison).
6. If the TUI was restarted, repeat 3-5 after restart (disk evidence persists).

### BEFORE ABORT (reconstruct from logs + observation)
- timestamp: wall-clock time Sean observed the hang / pressed Escape.
- parent session ID: from the parent/orchestrator session (session list).
- child session ID: the id the Task tool printed as `task_id` when the child was
  spawned (or from the `cancel sessionID=` log line after the fact).
- child task_id: == child session ID.
- child agent name: from Task tool params / session `title` (`@<agent> subagent`).
- child model and provider: `sessions.model` column (format `provider/model`).
- parent session status: `sessions.status` for parent id (expect busy/running
  while awaiting a foreground child).
- child session status: `sessions.status` for child id (expect busy).
- last completed child message/tool action: last child-session log activity
  before the `cancel` line for that session id.
- time since child last produced progress: abort timestamp - timestamp of last
  child-session log line.
- whether parent is blocked awaiting that foreground task: inherent for a
  foreground subagent; corroborated if parent `status` was busy and becomes
  idle/responsive after abort.

### ABORT (from backend log + db)
- session.abort requested for the child session ID: YES if a
  `cancel sessionID=<childID>` line exists in the log; else NO/UNKNOWN. This line
  is emitted by the `POST /:sessionID/abort` handler (`SessionPrompt.cancel`).
- SessionPrompt.cancel ran: same signal as above (logged at top of the function).
- SessionRunState.cancel ran: N/A - no such module; mapped to the same
  `SessionPrompt.cancel` / abort-controller fire (see note above).
- any returned error or exception: grep the log for `ERROR` around the abort
  timestamp / for the child session id.
- how long cancellation took: `SessionPrompt.cancel` is effectively synchronous
  (abort + status set in one call). Default logs do not record ms precision. If
  exact duration is required, add a `Log.time()` wrapper around the cancel path
  (optional, not required for this run).

### AFTER ABORT (from db + live check)
- child session status: `sessions.status` for child id -> expect `idle`.
- parent session status: `sessions.status` for parent id -> expect idle/responsive.
- child session record still exists: `SELECT id FROM sessions WHERE id=<childID>`
  returns a row.
- same task_id still exists: same as child session record (above).
- parent can accept and complete a harmless response: in the parent session send
  a harmless message and confirm a response is produced.
- files reverted/deleted/unexpectedly changed: compare `git status` before vs
  after; expect no unexpected changes.
- Kilo remained running without editor/process termination: confirm the
  editor/Kilo process is still alive after the abort and (if restarted) after
  restart.

### Resume the same child (preserved task_id)
In the parent/orchestrator session, invoke the Task tool with:
- `task_id`: <child session ID>
- `prompt`: (the recovery prompt below)

The Task tool reads the existing session (does not create a new one) and
continues the same conversation/context.

Recovery prompt:
  Do not continue the implementation. Provide only a recovery report:
  1. Your last completed step before interruption.
  2. What step was pending.
  3. Whether your earlier conversation and repository context are still available.
  4. Whether your completed file reads, notes, and reasoning remain available.
  5. Whether you observed an interruption, cancellation, provider error, or tool error.
  6. Whether you could safely continue from this same task session.

Append the resumed child's response to this report.

### Orchestrator conclusion
Append the parent/orchestrator's own conclusion (what was observed, whether the
interrupt worked end-to-end).

## Result block (fill exactly)
SUBAGENT_INTERRUPT_RUNTIME_RESULT
abort_request_reached_backend: YES/NO/UNKNOWN
child_returned_to_idle: YES/NO/UNKNOWN
parent_became_responsive: YES/NO/UNKNOWN
kilo_process_remained_running: YES/NO/UNKNOWN
child_session_preserved: YES/NO/UNKNOWN
same_task_id_resumed: YES/NO/UNKNOWN
child_context_preserved: YES/NO/UNKNOWN
files_preserved: YES/NO/UNKNOWN
errors: NONE or exact error text
report_path: C:\Users\seand\kilocode\.kilo\notes\subagent-interrupt-runtime-latest.md
