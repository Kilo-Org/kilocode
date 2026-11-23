import type { SECTION_COLORS } from "../section-colors"

type Status = "working" | "finished" | "needs-you"

type SectionColor = (typeof SECTION_COLORS)[number]["label"]

export interface Session {
  id: string
  title: string
  branch?: string
  note?: string
  status?: Status
  pr?: number
  diff?: { additions: number; deletions: number }
  selected?: boolean
}

interface Section {
  id: string
  name: string
  color: SectionColor
  sessions: readonly Session[]
}

type Entry =
  | { kind: "local"; branch: string }
  | { kind: "session"; session: Session }
  | { kind: "section"; section: Section }
  | { kind: "versions"; id: string; sessions: readonly Session[] }

interface Project {
  id: string
  name: string
  rows: readonly Entry[]
}

interface Fixture {
  projects: readonly Project[]
}

/** A sidebar row a feature points at, by fixture ids. */
export type Row =
  | { kind: "project"; project: string }
  | { kind: "section"; project: string; section: string }
  | { kind: "group"; project: string; group: string }
  | { kind: "session"; project: string; session: string }

interface Feature {
  name: string
  text: string
  row: Row
}

export interface Example {
  id: "crossStack" | "delegate" | "compare"
  tag: string
  title: string
  pitch: string
  features: readonly Feature[]
  fixture: Fixture
}

export const examples: readonly Example[] = [
  {
    id: "crossStack",
    tag: "agentManager.splash.examples.crossStack.tag",
    title: "agentManager.splash.examples.crossStack.title",
    pitch: "agentManager.splash.examples.crossStack.pitch",
    features: [
      {
        name: "agentManager.splash.examples.crossStack.feature1.name",
        text: "agentManager.splash.examples.crossStack.feature1.text",
        row: { kind: "project", project: "billing-api" },
      },
      {
        name: "agentManager.splash.examples.crossStack.feature2.name",
        text: "agentManager.splash.examples.crossStack.feature2.text",
        row: { kind: "session", project: "billing-api", session: "usage-metering" },
      },
      {
        name: "agentManager.splash.examples.crossStack.feature3.name",
        text: "agentManager.splash.examples.crossStack.feature3.text",
        row: { kind: "session", project: "web-app", session: "pricing-page" },
      },
    ],
    fixture: {
      projects: [
        {
          name: "billing-api",
          id: "billing-api",
          rows: [
            {
              kind: "session",
              session: {
                title: "Usage billing: metering endpoint",
                id: "usage-metering",
                branch: "usage-metering",
                status: "working",
                diff: { additions: 142, deletions: 18 },
              },
            },
          ],
        },
        {
          name: "web-app",
          id: "web-app",
          rows: [
            {
              kind: "session",
              session: {
                title: "Usage billing: pricing page",
                id: "pricing-page",
                branch: "pricing-page",
                status: "finished",
                pr: 889,
                selected: true,
              },
            },
          ],
        },
        {
          name: "infra",
          id: "infra",
          rows: [
            {
              kind: "session",
              session: {
                title: "Usage billing: queue and alarms",
                id: "billing-queue",
                branch: "billing-queue",
                status: "needs-you",
                diff: { additions: 36, deletions: 4 },
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: "delegate",
    tag: "agentManager.splash.examples.delegate.tag",
    title: "agentManager.splash.examples.delegate.title",
    pitch: "agentManager.splash.examples.delegate.pitch",
    features: [
      {
        name: "agentManager.splash.examples.delegate.feature1.name",
        text: "agentManager.splash.examples.delegate.feature1.text",
        row: { kind: "session", project: "kernel-sched", session: "lead" },
      },
      {
        name: "agentManager.splash.examples.delegate.feature2.name",
        text: "agentManager.splash.examples.delegate.feature2.text",
        row: { kind: "session", project: "kernel-sched", session: "rq-lock" },
      },
      {
        name: "agentManager.splash.examples.delegate.feature3.name",
        text: "agentManager.splash.examples.delegate.feature3.text",
        row: { kind: "session", project: "kernel-sched", session: "kthread-pin" },
      },
    ],
    fixture: {
      projects: [
        {
          name: "kernel-sched",
          id: "kernel-sched",
          rows: [
            { kind: "local", branch: "main" },
            {
              kind: "section",
              section: {
                name: "SCHEDULER",
                id: "scheduler",
                color: "Purple",
                sessions: [
                  {
                    title: "Lead · scheduler latency pass",
                    id: "lead",
                    note: "started 3 sessions · 1 done",
                    status: "working",
                    selected: true,
                  },
                ],
              },
            },
            {
              kind: "section",
              section: {
                name: "PATCHES",
                id: "patches",
                color: "Blue",
                sessions: [
                  {
                    title: "Reduce run-queue lock contention",
                    id: "rq-lock",
                    branch: "rq-lock",
                    status: "finished",
                    pr: 212,
                  },
                  {
                    title: "Batch io_uring submissions",
                    id: "uring-batch",
                    branch: "uring-batch",
                    status: "working",
                    diff: { additions: 58, deletions: 21 },
                  },
                  {
                    title: "Pin hot kthreads to isolated cores",
                    id: "kthread-pin",
                    branch: "kthread-pin",
                    status: "needs-you",
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: "compare",
    tag: "agentManager.splash.examples.compare.tag",
    title: "agentManager.splash.examples.compare.title",
    pitch: "agentManager.splash.examples.compare.pitch",
    features: [
      {
        name: "agentManager.splash.examples.compare.feature1.name",
        text: "agentManager.splash.examples.compare.feature1.text",
        row: { kind: "group", project: "storefront", group: "cold-start" },
      },
      {
        name: "agentManager.splash.examples.compare.feature2.name",
        text: "agentManager.splash.examples.compare.feature2.text",
        row: { kind: "session", project: "storefront", session: "cold-start-a" },
      },
      {
        name: "agentManager.splash.examples.compare.feature3.name",
        text: "agentManager.splash.examples.compare.feature3.text",
        row: { kind: "session", project: "storefront", session: "cold-start-b" },
      },
    ],
    fixture: {
      projects: [
        {
          name: "storefront",
          id: "storefront",
          rows: [
            { kind: "local", branch: "main" },
            {
              kind: "versions",
              id: "cold-start",
              sessions: [
                {
                  title: "Cut cold start time · Kilo Auto",
                  id: "cold-start-a",
                  branch: "cold-start-a",
                  status: "finished",
                  diff: { additions: 64, deletions: 40 },
                },
                {
                  title: "Cut cold start time · Claude",
                  id: "cold-start-b",
                  branch: "cold-start-b",
                  status: "finished",
                  pr: 58,
                  selected: true,
                },
                {
                  title: "Cut cold start time · GPT",
                  id: "cold-start-c",
                  branch: "cold-start-c",
                  status: "working",
                  diff: { additions: 21, deletions: 9 },
                },
              ],
            },
          ],
        },
      ],
    },
  },
]
