---
title: "Troubleshooting"
description: "Common issues and how to resolve them"
---

# {% $markdoc.frontmatter.title %}

Gas Town is a complex system with multiple agents, containers, and external integrations. When things go wrong, this guide helps you diagnose and fix common issues.

## Agents Not Picking Up Work

**Symptom:** Beads stay in `open` status. No agents transition to `working`.

**Common causes:**

| Cause | Fix |
|---|---|
| All polecats at max dispatch attempts | Ask the Mayor: *"Reset agent dispatch attempts"* |
| Reconciler paused (draining) | Wait for drain to complete |
| No available polecats | Check `max_polecats_per_rig` — you may need to increase it |

**Quick fix:** Ask the Mayor: *"Why aren't beads getting picked up?"* — it can diagnose and often resolve the issue.

## Container Not Starting

**Symptom:** The container status shows errors or stays in "starting" indefinitely.

**Common causes:**
- Git clone failure (bad credentials, repo not accessible)
- GitHub App not installed on the repository
- Environment variables causing startup crash

**Fix:**
1. Check that the [Kilo GitHub App](https://github.com/apps/kilo-code) is installed on your repository
2. Verify your GitHub PAT is valid (if configured)
3. Remove any environment variables that might cause issues during container init
4. Try a container restart from town settings

## Git Authentication Failures

**Symptom:** Agents can't clone, push, or fetch. Errors mention "authentication failed" or "permission denied".

**Common causes:**

| Cause | Fix |
|---|---|
| GitHub App uninstalled | Reinstall at [github.com/apps/kilo-code](https://github.com/apps/kilo-code) |
| PAT expired or revoked | Generate a new token and update in Settings → Git & Authentication |
| Repository visibility changed | Ensure the GitHub App has access to the repo |
| Org SSO not authorized | Authorize the token for your organization's SSO |

**Diagnosis:** The Mayor may report *"git credential refresh failed: no_installation_found"* — this definitively means the GitHub App needs to be reinstalled.

## Review Loop / Stuck in Review

**Symptom:** A bead cycles between `in_review` and `in_progress` repeatedly, or MR beads keep failing.

**Common causes:**
- The refinery finds issues the polecat can't fix (e.g., fundamental architecture problems)
- Missing PR URL on merge request beads
- Convoy feature branch deleted from remote

**Fix:**
1. Check the bead's event history for review feedback
2. If the feedback is a dead end, ask the Mayor to close the bead: *"Close bead [id] — the approach isn't working"*
3. For stuck convoys, the Mayor can force-close: *"Force close convoy [name]"*

{% callout type="info" %}
Beads automatically escalate after 3 failed review cycles. If a bead is genuinely stuck in a loop, it will eventually fail and notify you rather than running forever.
{% /callout %}

## The Mayor is Unresponsive

**Symptom:** Messages to the Mayor don't get responses, or the Mayor says it's "unauthenticated".

**Common causes:**
- Container sleeping (wakes up after ~30 seconds)
- KILOCODE_TOKEN expired
- Gateway authentication failure

**Fix:**
1. Wait 30 seconds — the container may be waking from sleep
2. If persistent: go to Settings → refresh the container token
3. If still failing: go to settings, force container shutdown

## Convoy Stuck / Never Completes

**Symptom:** A convoy shows open but no beads are being dispatched, or it never reaches "landed".

**Common causes:**
- Upstream dependency bead failed (blocks downstream)
- Convoy feature branch doesn't exist on remote
- Landing MR repeatedly failing

**Fix:**
1. Check convoy progress: which beads are closed? which are open/failed?
2. For failed dependencies: fix or close the blocking bead, then downstream beads will dispatch
3. Ask the Mayor: *"What's blocking convoy [name]?"*
4. If truly stuck: force-close the convoy and re-create it

## Agent Permanently Stuck

**Symptom:** An agent shows as `working` but hasn't produced output for 20+ minutes.

**Common causes:**
- Container process crashed but heartbeat continues
- Agent waiting on an external resource (network, API)
- Infinite loop in agent execution

**Fix:**
1. Ask the Mayor: *"Reset agent [name]"*
2. This clears the hook, resets the agent to idle, and returns the bead to `open`
3. The reconciler will re-dispatch the bead to a fresh agent

## High Failure Rate

**Symptom:** Many beads ending in `failed` status.

**Common causes:**
- Task descriptions are too vague (agents can't figure out what to do)
- The codebase has issues that prevent agents from working (broken build, missing dependencies)
- Model quality is too low for the complexity of the work

**Fix:**
1. Review failed bead descriptions — make them more specific
2. Ensure the repo builds cleanly (agents struggle with pre-existing broken builds)
3. Consider upgrading the model (Auto Balanced → Auto Frontier for complex work)
4. Add custom instructions to guide agents: test commands, build steps, conventions

## Getting Help

If you can't resolve an issue:

1. **Ask the Mayor** — it can diagnose most problems
2. **Check the event timeline** — see exactly what happened and when
3. **Contact support** — reach out at [kilo.ai/discord](https://kilo.ai/discord) with your town ID
