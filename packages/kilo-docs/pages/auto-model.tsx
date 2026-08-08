import { useState } from "react"
import Head from "next/head"
import Link from "next/link"

type ScenarioId = "without" | "with"

const SCENARIOS: { id: ScenarioId; label: string; frontierShare: number; caption: string }[] = [
  {
    id: "without",
    label: "Every request pinned to one frontier model",
    frontierShare: 100,
    caption: "The common default: send every request, big or small, to the priciest closed model available.",
  },
  {
    id: "with",
    label: "Kilo Auto routing turned on",
    frontierShare: 20,
    caption: "Roughly what we see in practice across real Kilo sessions once Auto is deciding per request.",
  },
]

const SEGMENTS = [
  {
    id: "frontier" as const,
    name: "Frontier closed models",
    color: "#f8c574",
    examples: [
      "Multi-file architecture changes",
      "Security- or data-sensitive edits",
      "Ambiguous or high-risk requests",
      "Long-horizon agentic planning",
    ],
  },
  {
    id: "efficient" as const,
    name: "Efficient open-weight models",
    color: "#7ad0c4",
    examples: [
      "Small refactors and cleanups",
      "Boilerplate and scaffolding",
      "Straightforward bug fixes",
      "Docs, tests, and simple edits",
    ],
  },
]

const HOW_IT_WORKS = [
  {
    title: "Classify the request",
    body: "Each request is scored the moment it arrives — what kind of task it is, how much context it carries, how much reasoning it likely needs, and how risky a wrong answer would be.",
  },
  {
    title: "Match it to a benchmarked model",
    body: "That score is matched against a routing table of models ranked by cost-per-accuracy on coding benchmarks, so Auto reaches for the cheapest model that can actually do the job well — not just the cheapest model, period.",
  },
  {
    title: "Stay put for the rest of the session",
    body: "Once a conversation picks a model, Auto sticks with it for the rest of that session. That keeps prompt caching working and keeps the model's understanding of your codebase consistent, instead of thrashing between models mid-task.",
  },
]

const ENTERPRISE_FEATURES = [
  {
    title: "Provider and model controls",
    body: "Restrict which model providers your org can use at all, and deny specific models outright — org-wide, for every seat.",
  },
  {
    title: "Force a default model",
    body: "Skip Auto entirely if you want: pin every request in your organization to one specific model.",
  },
  {
    title: "Custom Auto routing",
    body: "Admins can define their own routing table — mapping specific coding modes or task types to specific models, with a fallback for anything unmapped — instead of using the default Kilo Auto behavior.",
  },
  {
    title: "Team-level access policies",
    body: "Different teams can have different allowed models, so a research group and a production team can run under different rules inside the same org.",
  },
  {
    title: "Training opt-out",
    body: "Opt out of any model providers that may train on your prompts, at the organization level.",
  },
  {
    title: "Spend visibility and limits",
    body: "Balance and spend alerting, plus usage limits, so nobody finds out about a runaway session from a surprise invoice.",
  },
  {
    title: "Audit logging",
    body: "Every change to routing settings and access policies is logged for compliance review.",
  },
  {
    title: "Per-request transparency",
    body: 'Every request records both the model that was requested (including "Auto") and the model that actually served it, so nothing is a black box after the fact.',
  },
]

export default function AutoModelPage() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("with")
  const [hovered, setHovered] = useState<"frontier" | "efficient" | null>(null)

  const active = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[1]
  const frontierShare = active.frontierShare
  const efficientShare = 100 - frontierShare

  return (
    <div className="auto-model-page">
      <Head>
        <title>Kilo Auto: automatic model routing for coding agents</title>
        <meta
          name="description"
          content="Kilo Auto scores every coding request for task type, context size, reasoning complexity, and risk, then routes it to the model with the best cost-per-accuracy for the job."
        />
      </Head>

      {/* Hero */}
      <section className="hero">
        <span className="eyebrow">Kilo Auto</span>
        <h1 className="hero-title">One model setting. A whole routing decision underneath.</h1>
        <p className="hero-subtitle">
          Set your agent to <code>Auto</code> and Kilo scores every request for task type, context size, reasoning
          complexity, and risk — then sends it to the most cost-effective model that can actually handle it. Not the
          cheapest model. The cheapest model that gets it right.
        </p>
        <div className="hero-buttons">
          <Link href="https://kilo.ai/get-started" className="btn btn-primary">
            Get started free →
          </Link>
          <a href="mailto:sales@kilocode.ai" className="btn btn-secondary">
            Talk to sales
          </a>
        </div>
      </section>

      {/* Not every task needs a frontier model */}
      <section className="chart-section">
        <h2 className="section-title centered">Not every task needs a frontier model</h2>
        <p className="section-subtitle centered">
          Frontier closed models are excellent at hard, high-stakes work. Most day-to-day coding — small refactors,
          straightforward implementation, routine debugging — doesn&apos;t need that firepower, and efficient
          open-weight models handle it well for a fraction of the cost.
        </p>

        <div className="toggle-row">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`toggle-btn ${scenarioId === s.id ? "active" : ""}`}
              onClick={() => setScenarioId(s.id)}
              aria-pressed={scenarioId === s.id}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="bar">
          <div
            className={`bar-segment ${hovered === "frontier" ? "hovered" : ""}`}
            style={{ width: `${frontierShare}%`, background: SEGMENTS[0].color }}
            onMouseEnter={() => setHovered("frontier")}
            onMouseLeave={() => setHovered(null)}
          >
            {frontierShare >= 12 && <span>~{frontierShare}%</span>}
          </div>
          <div
            className={`bar-segment ${hovered === "efficient" ? "hovered" : ""}`}
            style={{ width: `${efficientShare}%`, background: SEGMENTS[1].color }}
            onMouseEnter={() => setHovered("efficient")}
            onMouseLeave={() => setHovered(null)}
          >
            {efficientShare >= 12 && <span>~{efficientShare}%</span>}
          </div>
        </div>
        <p className="bar-caption">{active.caption}</p>

        <div className="segment-cards">
          {SEGMENTS.map((seg) => (
            <div
              key={seg.id}
              className={`segment-card ${hovered === seg.id ? "hovered" : ""}`}
              onMouseEnter={() => setHovered(seg.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="segment-card-header">
                <span className="dot" style={{ background: seg.color }} />
                <strong>{seg.name}</strong>
              </div>
              <ul>
                {seg.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="fine-print">
          This is a directional illustration, not a live metric. Kilo Auto optimizes for cost-per-accuracy on every
          request rather than tracking an open-vs-closed split, but this is roughly the shape of what that
          optimization produces across a typical mix of coding tasks.
        </p>
      </section>

      {/* How it works */}
      <section className="how-section">
        <h2 className="section-title centered">How Auto routing works</h2>
        <p className="section-subtitle centered">
          No dashboards to tune, no model names to memorize. Auto makes the call on every single request.
        </p>
        <div className="how-grid">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={step.title} className="how-card">
              <span className="step-number">Step {i + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Enterprise */}
      <section className="enterprise-section">
        <span className="eyebrow centered">For organizations</span>
        <h2 className="section-title centered">Auto, with your org&apos;s guardrails on top</h2>
        <p className="section-subtitle centered">
          Automatic routing is opinionated by default — enterprises get to decide how opinionated. Admins can keep
          Auto&apos;s defaults, replace them with their own routing table, or lock things down entirely.
        </p>
        <div className="enterprise-grid">
          {ENTERPRISE_FEATURES.map((feature) => (
            <div key={feature.title} className="enterprise-card">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2 className="section-title centered">Stop choosing a model. Start shipping.</h2>
        <p className="section-subtitle centered">
          Turn on Auto and let every request find its own best-fit model — or talk to us about rolling it out with
          custom routing rules across your team.
        </p>
        <div className="hero-buttons centered">
          <Link href="https://kilo.ai/get-started" className="btn btn-primary">
            Get started free →
          </Link>
          <a href="mailto:sales@kilocode.ai" className="btn btn-secondary">
            Talk to sales for enterprise
          </a>
        </div>
      </section>

      <style jsx>{`
        .auto-model-page {
          position: relative;
          max-width: 1100px;
          margin: 0 auto;
          padding: 3rem 2rem 5rem;
        }

        .eyebrow {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent-color);
          margin-bottom: 0.75rem;
        }

        .eyebrow.centered {
          text-align: center;
        }

        .hero {
          padding: 2rem 0 4rem;
          max-width: 720px;
        }

        .hero-title {
          font-size: 2.75rem;
          font-weight: 700;
          line-height: 1.15;
          margin: 0 0 1.25rem;
          color: var(--text-brand);
        }

        .hero-subtitle {
          font-size: 1.15rem;
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0 0 2rem;
        }

        .hero-subtitle code {
          background: var(--bg-secondary);
          border-radius: 4px;
          padding: 0.1rem 0.4rem;
          font-size: 0.95em;
        }

        .hero-buttons {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .hero-buttons.centered {
          justify-content: center;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.9rem 1.75rem;
          border-radius: 4px;
          font-weight: 500;
          font-size: 1rem;
          text-decoration: none;
          transition: all 0.15s ease;
          border: 2px solid transparent;
          cursor: pointer;
        }

        .btn-primary {
          background: #f8f674;
          color: #1a1a18;
          border-color: #f8f674;
          white-space: nowrap;
        }

        .btn-primary:hover {
          background: #ffff8d;
          border-color: #ffff8d;
          transform: translateY(-1px);
        }

        .btn-secondary {
          background: transparent;
          color: var(--text-secondary);
          border: 2px solid var(--text-secondary);
        }

        :global(.dark) .btn-secondary {
          color: #888;
          border-color: #555;
        }

        .btn-secondary:hover {
          color: var(--text-brand);
          border-color: var(--text-brand);
        }

        :global(.dark) .btn-secondary:hover {
          color: #f8f674;
          border-color: #f8f674;
        }

        section {
          padding: 3.5rem 0;
          border-top: 1px solid var(--border-color);
        }

        .hero {
          border-top: none;
          padding-top: 1rem;
        }

        .section-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 0.75rem;
          color: var(--text-brand);
        }

        .section-title.centered {
          text-align: center;
        }

        .section-subtitle {
          font-size: 1.05rem;
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 640px;
          margin: 0 auto 2.5rem;
        }

        .section-subtitle.centered {
          text-align: center;
        }

        /* Chart */
        .toggle-row {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 2rem;
        }

        .toggle-btn {
          font-size: 0.85rem;
          font-weight: 500;
          padding: 0.6rem 1.1rem;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .toggle-btn:hover {
          border-color: var(--accent-color);
          color: var(--text-brand);
        }

        .toggle-btn.active {
          background: var(--text-brand);
          border-color: var(--text-brand);
          color: var(--bg-color);
        }

        .bar {
          display: flex;
          height: 2.75rem;
          max-width: 720px;
          margin: 0 auto;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--border-color);
        }

        .bar-segment {
          display: flex;
          align-items: center;
          justify-content: center;
          transition: width 0.6s ease, filter 0.2s ease;
          color: #1a1a18;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .bar-segment.hovered {
          filter: brightness(1.08);
        }

        .bar-caption {
          text-align: center;
          color: var(--text-secondary);
          max-width: 640px;
          margin: 1rem auto 0;
          font-size: 0.95rem;
        }

        .segment-cards {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.25rem;
          max-width: 720px;
          margin: 2.5rem auto 0;
        }

        .segment-card {
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.25rem;
          background: var(--bg-color);
          transition: border-color 0.2s ease, transform 0.2s ease;
        }

        .segment-card.hovered {
          border-color: var(--accent-color);
          transform: translateY(-2px);
        }

        .segment-card-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.6rem;
          color: var(--text-brand);
        }

        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .segment-card ul {
          margin: 0;
          padding-left: 1.1rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.6;
        }

        .fine-print {
          text-align: center;
          color: var(--text-secondary);
          font-size: 0.85rem;
          max-width: 640px;
          margin: 2rem auto 0;
          line-height: 1.6;
        }

        /* How it works */
        .how-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
        }

        .how-card {
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.5rem;
          background: var(--bg-color);
        }

        .step-number {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--accent-color);
          margin-bottom: 0.5rem;
        }

        .how-card h3 {
          font-size: 1.1rem;
          margin: 0 0 0.5rem;
          color: var(--text-brand);
        }

        .how-card p {
          font-size: 0.92rem;
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0;
        }

        /* Enterprise */
        .enterprise-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1.25rem;
        }

        .enterprise-card {
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.25rem;
          background: var(--bg-color);
        }

        .enterprise-card h3 {
          font-size: 0.98rem;
          margin: 0 0 0.5rem;
          color: var(--text-brand);
        }

        .enterprise-card p {
          font-size: 0.88rem;
          color: var(--text-secondary);
          line-height: 1.55;
          margin: 0;
        }

        .cta-section {
          text-align: center;
        }

        @media (max-width: 900px) {
          .how-grid {
            grid-template-columns: 1fr;
          }
          .enterprise-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .segment-cards {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 600px) {
          .hero-title {
            font-size: 2rem;
          }
          .enterprise-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
