---
title: "Improving Your Score"
description: "Tips and strategies to improve your AI adoption score"
---

# Improving Your Score

This guide provides actionable strategies to improve each dimension of your AI Adoption Score. Click on any dimension in the dashboard to see personalized suggestions based on your team's usage patterns.

## Improving Frequency

**Goal:** Help developers build AI into their daily workflow, not just reach for it on hard problems.

### Expand Beyond the IDE

A lot of development work happens in the terminal—git operations, debugging, scripting. Bringing AI to those contexts increases daily touchpoints.

**Action:** Install the Kilo CLI to enable AI-assisted terminal workflows:

```bash
npm install -g @kilocode/cli
```

Teams that use both IDE and CLI surfaces tend to show higher daily engagement because AI is available wherever they're working.

### Start with Autocomplete

Autocomplete is low-friction by design. It doesn't require explicit prompting—it just works in the background.

**Action:** Encourage your team to lean on autocomplete for:

- Boilerplate code
- Repetitive patterns
- Common syntax
- Test scaffolding

Building muscle memory with autocomplete leads to consistent daily usage without requiring behavior change.

### Tie AI to Existing Routines

The teams with the strongest Frequency scores usually aren't doing anything flashy—they've woven AI into things they already do.

**Action:** Identify daily tasks where AI can help:

- **Stand-up prep** — Summarize recent changes or generate status updates
- **Context checks** — Quickly understand unfamiliar code
- **PR descriptions** — Generate first drafts of pull request descriptions
- **Documentation** — Create or update inline comments

Small, repeated use cases add up faster than occasional heavy lifts.

---

## Improving Depth

**Goal:** Move AI from a side tool to an integrated part of how your team ships code.

### Chain Your Workflows

Depth increases when AI touches multiple stages of the same task. Each handoff reinforces context and keeps AI in the loop from idea to merge.

**Action:** Adopt the "chain" workflow pattern:

1. **Plan** — Use Architect mode to design a feature
2. **Build** — Use Code mode to implement it
3. **Review** — Use Code Reviews to critique it

{% callout type="tip" %}
Linking coding → review → deploy actions significantly boosts your Depth score.
{% /callout %}

### Give AI Better Context

If acceptance rates are low, the issue is often context. The AI is making suggestions without understanding your codebase.

**Action:** Enable [Managed Indexing](/advanced-usage/managed-indexing) to give the model vector-backed search across your repository.

Better context leads to:

- More relevant suggestions
- Higher acceptance rates
- Greater trust in AI output
- Deeper integration over time

### Validate AI Output in Real Environments

Generated code that never runs is hard to trust. Teams that can verify AI output against live environments tend to retain more of that code long-term.

**Action:** Use [Kilo Deploy](/advanced-usage/deploy) to spin up live URLs for branches, allowing your team to verify changes before merging.

---

## Improving Coverage

**Goal:** Get more of your team using more of the platform.

### Introduce Specialist Agents

Most teams start with Code mode and stop there. But Kilo's other modes unlock additional value.

**Action:** Introduce your team to specialized modes:

| Mode             | Use Case                                                 |
| ---------------- | -------------------------------------------------------- |
| **Orchestrator** | Delegate and execute subtasks over long-horizon projects |
| **Architect**    | Design and plan before implementation                    |
| **Debug**        | Systematic error diagnosis                               |
| **Ask**          | Quick questions and explanations                         |

This increases efficacy and improves trust in AI-facilitated tasking.

### Activate Unused Seats

Coverage is partly a numbers game. If you have team members who haven't logged in or aren't using the tool, your score will reflect that.

**Action:** Check your Organization Dashboard for inactive seats. Consider whether those team members need:

- A reminder that access exists
- A walkthrough or onboarding session
- Guidance on where to start
- Pairing with an enthusiastic team member

### Spread Usage Across the Week

Spiky usage—heavy on Mondays, quiet the rest of the week—limits your Coverage score.

**Action:** Make [Code Reviews](/advanced-usage/code-reviews) part of your PR process. Reviews happen throughout the week, so AI usage naturally follows.

Other ways to spread usage:

- Daily stand-up preparation with AI
- End-of-day documentation or commit messages
- Mid-week design reviews using Architect mode

---

## Common Patterns and Anti-Patterns

### Patterns That Drive Adoption

| Pattern                          | Why It Works                                       |
| -------------------------------- | -------------------------------------------------- |
| **Pair AI with existing tools**  | Developers don't have to learn new workflows       |
| **Start with quick wins**        | Autocomplete and commit messages build confidence  |
| **Champion-led adoption**        | Enthusiastic team members model effective usage    |
| **Weekly check-ins on AI usage** | Keeps AI top-of-mind without being prescriptive    |
| **Celebrate retained code**      | Recognize when AI contributions ship to production |

### Anti-Patterns to Avoid

| Anti-Pattern                        | Why It Fails                                  |
| ----------------------------------- | --------------------------------------------- |
| **Mandating specific usage levels** | Creates resentment without changing habits    |
| **Focusing only on power users**    | Neglects the majority who need onboarding     |
| **Ignoring context quality**        | Leads to poor suggestions and abandoned usage |
| **Measuring without acting**        | Scores drop when no one addresses gaps        |
| **All-or-nothing adoption**         | Teams need gradual, sustainable change        |

---

## Quick Wins by Score Range

### If You're at 0–20 (Minimal Adoption)

1. Ensure all team members have access and are logged in
2. Run a 30-minute "Getting Started" session
3. Ask everyone to try autocomplete for one week
4. Check back on completion rates

### If You're at 21–50 (Early Adoption)

1. Identify your most active users and learn what they're doing
2. Introduce Code Reviews to spread usage
3. Enable Managed Indexing for better context
4. Set a monthly score goal (e.g., "reach 55 by next month")

### If You're at 51–75 (Growing Adoption)

1. Introduce chained workflows (plan → build → review)
2. Focus on Depth—are suggestions being accepted and retained?
3. Address any inactive seats or low-usage pockets
4. Consider Kilo Deploy to validate AI output

### If You're at 76–90 (Strong Adoption)

1. You're doing well—maintain momentum
2. Look at retention rates: what percentage of AI code ships unaltered?
3. Expand to edge cases: CI/CD, documentation, testing
4. Share your practices with other teams

## Next Steps

- [Use the dashboard for team leadership](/plans/adoption-dashboard/for-team-leads)
- [Return to the dashboard overview](/plans/adoption-dashboard/overview)
