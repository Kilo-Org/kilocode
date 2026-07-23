---
"@kilocode/cli": minor
---

Add a `notify_user` tool that lets an agent send a push notification to the user's phone (Kilo mobile app) for explicitly requested pings and significant mid-run milestones. The tool sends a single `agent_notification` item over the session's existing authenticated ingest channel with a bounded readiness wait, returns a friendly failure when the session is not connected to Kilo cloud, and never prompts for permission. Delivery may still be suppressed server-side by the user's notification preference, per-session rate limits, or active presence in the session.
