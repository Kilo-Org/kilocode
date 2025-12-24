---
sidebar_label: For Team Leads
---

# AI Adoption Dashboard for Team Leads

This guide covers how engineering managers and team leads can use the AI Adoption Dashboard to drive AI integration, identify gaps, and communicate progress to stakeholders.

## Reading Team-Wide Metrics

### The Organization View

Disable the **"Only my usage"** toggle to see aggregated metrics across your entire team. This view shows:

- **Overall AI Adoption Score** — Your single benchmark number
- **Dimension breakdown** — Frequency, Depth, and Coverage contributions
- **Week-over-week trends** — Direction and magnitude of change
- **Historical timeline** — Score progression over days, weeks, or months

### Dimension Detail Panels

Click on any dimension card (Frequency, Depth, or Coverage) to open its detail panel. Each panel provides:

- A focused timeline for that dimension
- The goal statement for that dimension
- Three actionable improvement suggestions tailored to what that dimension measures

Use these panels to diagnose specific issues and identify targeted actions.

### Comparing Time Periods

Switch between time filters to understand different patterns:

| Filter         | Best For                                         |
| -------------- | ------------------------------------------------ |
| **Past Week**  | Recent changes, sprint-level trends              |
| **Past Month** | Adoption initiative tracking, onboarding results |
| **Past Year**  | Long-term trends, seasonal patterns              |
| **All**        | Historical baseline, major milestones            |

---

## Identifying Adoption Gaps

### Low Coverage Signals

A low Coverage score often indicates adoption gaps—pockets of your team that aren't using AI.

**Questions to investigate:**

- Are all team members logged in and active?
- Are certain roles or squads under-represented?
- Is usage concentrated on specific days (spiky pattern)?

**Actions:**

1. Check your Organization Dashboard for inactive seats
2. Look for patterns in who's not using AI (new hires? certain roles?)
3. Consider targeted onboarding or pairing sessions

### Low Depth Signals

Low Depth indicates that developers may be trying AI but not trusting or shipping its output.

**Questions to investigate:**

- Are acceptance rates low? (Developers rejecting suggestions)
- Is AI-generated code being merged?
- Are developers using AI across multiple stages (plan → build → review)?

**Actions:**

1. Enable [Managed Indexing](/advanced-usage/managed-indexing) to improve context quality
2. Review whether suggestions are relevant to your codebase
3. Introduce chained workflows to increase multi-stage usage

### Low Frequency Signals

Low Frequency suggests AI hasn't become a daily habit.

**Questions to investigate:**

- Are developers aware of all available AI surfaces (IDE, CLI, Cloud)?
- Is AI usage triggered only by specific, infrequent problems?
- Have developers built AI into routine tasks?

**Actions:**

1. Map AI to existing daily tasks (stand-ups, PRs, documentation)
2. Ensure the CLI is installed for terminal workflows
3. Run a "try autocomplete for a week" challenge

---

## Running Adoption Initiatives

### Setting Goals

Use the score tiers as milestones:

| Current Tier    | Reasonable Next Goal         |
| --------------- | ---------------------------- |
| 0–20 (Minimal)  | Reach 30–40 within 4–6 weeks |
| 21–50 (Early)   | Reach 55–65 within 4–6 weeks |
| 51–75 (Growing) | Reach 75–80 within 6–8 weeks |
| 76–90 (Strong)  | Maintain and optimize        |

**Tip:** Focus on one dimension at a time rather than trying to improve everything at once.

### Initiative Ideas

**For Frequency:**

- "Autocomplete Week" — Everyone commits to using autocomplete daily
- CLI onboarding session — 30-minute walkthrough of terminal AI
- Daily AI tip in Slack — Share one use case per day

**For Depth:**

- "Chain Challenge" — Complete one feature using plan → build → review
- Managed Indexing rollout — Enable better context for the whole team
- Deploy previews — Validate AI output before merging

**For Coverage:**

- New hire onboarding includes Kilo setup
- Weekly "AI wins" sharing in stand-ups
- Pair low-usage developers with enthusiastic adopters

### Tracking Progress

1. **Set a baseline** — Note your score at the start of an initiative
2. **Check weekly** — Watch for trend changes, not absolute numbers
3. **Adjust tactics** — If a dimension isn't moving, try a different approach
4. **Celebrate wins** — Acknowledge when the team hits a milestone

---

## Benchmarking Against Goals

### Internal Benchmarking

Use the score to compare:

- **Teams within your organization** — Which teams are leading adoption?
- **Before vs. after** — Did a specific initiative move the needle?
- **This quarter vs. last** — Are you trending up or down?

### Communicating to Stakeholders

The AI Adoption Score is designed to be quotable:

> "Last quarter we were at 38. This quarter we're at 57. Our goal is to reach 70 by Q2."

**When presenting scores:**

- Lead with the trend, not just the number
- Explain the tier and what it means
- Connect to business outcomes ("Higher adoption → faster development cycles")
- Share specific actions you're taking

### Sample Stakeholder Update

> **AI Adoption Update — January 2025**
>
> - **Current Score:** 57 (Growing adoption tier)
> - **Last Month:** 48
> - **Change:** +9 points, driven by improved Depth scores
>
> **Key Actions Taken:**
>
> - Enabled Managed Indexing for better AI context
> - Introduced Code Reviews for all PRs
> - Onboarded 3 inactive team members
>
> **Next Steps:**
>
> - Target 65 by end of February
> - Focus on Coverage—spread usage across the full week

---

## Privacy and Data Considerations

### Anonymous Data

Individual usage data is anonymized in the dashboard. While you can see aggregate metrics, the dashboard does not expose individual developer activity to managers.

### Focus on Teams, Not Individuals

The Dashboard is designed for:

- Team-level insights
- Organizational trends
- Comparative benchmarking

It is **not** designed for:

- Individual performance evaluation
- Identifying specific low performers
- Surveillance of developer activity

Use the score to identify adoption **gaps**, not to judge individual developers.

---

## Future Enhancements

### Code Contribution Tracking

A future enhancement will track AI-contributed code from feature branch to main branch:

- What percentage of AI-suggested code actually ships?
- How much of the codebase was AI-assisted?

This metric is separate from the Adoption Score but valuable for measuring AI impact on output.

### Team Comparison Views

Additional views for comparing multiple teams within an organization are planned, enabling leadership to identify best practices from high-performing teams.

---

## Quick Reference: Dashboard Actions

| What You Want to Know        | Where to Look                               |
| ---------------------------- | ------------------------------------------- |
| Overall adoption level       | Main score display                          |
| Which dimension needs work   | Trend indicators (look for negative trends) |
| Specific improvement actions | Click dimension → detail panel              |
| Historical patterns          | Timeline chart with time filter             |
| Your personal usage          | Toggle "Only my usage"                      |
| Week-over-week change        | Metric cards at bottom                      |

## Next Steps

- [Understand what each dimension measures](/plans/adoption-dashboard/understanding-your-score)
- [Learn strategies to improve your score](/plans/adoption-dashboard/improving-your-score)
- [Return to the dashboard overview](/plans/adoption-dashboard/overview)
