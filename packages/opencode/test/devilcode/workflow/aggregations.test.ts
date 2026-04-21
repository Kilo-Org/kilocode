import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import {
  computeAggregations,
  computeAggregationsFromEvents,
  emptyAggregations,
} from "@/devilcode/workflow/aggregations"
import type { WorkflowEvent } from "@/devilcode/workflow/events"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aggr-test-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// emptyAggregations
// ---------------------------------------------------------------------------
describe("emptyAggregations", () => {
  it("returns zero-initialized structure", () => {
    const result = emptyAggregations()
    expect(result.successRateByTeam).toEqual({})
    expect(result.stallRateByPosition).toEqual({})
    expect(result.costByWorkflow).toEqual([])
    expect(result.durationByStage).toEqual({})
    expect(typeof result.generatedAt).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// computeAggregations (reads from disk)
// ---------------------------------------------------------------------------
describe("computeAggregations", () => {
  it("returns zero-initialized response when event log is missing", async () => {
    const result = await computeAggregations(tmpDir)
    expect(result.successRateByTeam).toEqual({})
    expect(result.costByWorkflow).toEqual([])
    expect(result.durationByStage).toEqual({})
  })

  it("returns zero-initialized response when event log is empty", async () => {
    await fs.writeFile(path.join(tmpDir, "events.jsonl"), "")
    const result = await computeAggregations(tmpDir)
    expect(result.successRateByTeam).toEqual({})
    expect(result.costByWorkflow).toEqual([])
  })

  it("filters events by since parameter", async () => {
    const events: WorkflowEvent[] = [
      {
        eventType: "task_started",
        taskId: "t1",
        role: "backend",
        message: "old",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      {
        eventType: "task_started",
        taskId: "t2",
        role: "backend",
        message: "new",
        timestamp: "2024-06-01T00:00:00.000Z",
      },
    ]
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await fs.writeFile(path.join(tmpDir, "events.jsonl"), lines)

    const result = await computeAggregations(tmpDir, { since: "2024-03-01T00:00:00.000Z" })
    // Only the June event should be processed — 1 started, 0 completed
    expect(result.successRateByTeam["default"]?.started).toBe(1)
    expect(result.successRateByTeam["default"]?.completed).toBe(0)
  })

  it("applies limit to cap events processed", async () => {
    const events: WorkflowEvent[] = Array.from({ length: 20 }, (_, i) => ({
      eventType: "task_started" as const,
      taskId: `t${i}`,
      role: "backend",
      message: `event ${i}`,
      timestamp: new Date(2024, 0, i + 1).toISOString(),
    }))
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await fs.writeFile(path.join(tmpDir, "events.jsonl"), lines)

    const result = await computeAggregations(tmpDir, { limit: 5 })
    // limit=5 takes last 5 events
    expect(result.successRateByTeam["default"]?.started).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// computeAggregationsFromEvents (pure function)
// ---------------------------------------------------------------------------
describe("computeAggregationsFromEvents", () => {
  it("returns empty aggregations for empty event array", () => {
    const result = computeAggregationsFromEvents([])
    expect(result.successRateByTeam).toEqual({})
    expect(result.costByWorkflow).toEqual([])
    expect(result.durationByStage).toEqual({})
    expect(result.stallRateByPosition).toEqual({})
  })

  it("counts task_started and task_completed per team", () => {
    const events: WorkflowEvent[] = [
      { eventType: "task_started", taskId: "t1", role: "backend", message: "start", metadata: { teamId: "team-alpha" } },
      { eventType: "task_started", taskId: "t2", role: "frontend", message: "start", metadata: { teamId: "team-alpha" } },
      { eventType: "task_completed", taskId: "t1", role: "backend", message: "done", metadata: { teamId: "team-alpha" } },
    ]
    const result = computeAggregationsFromEvents(events)
    const alpha = result.successRateByTeam["team-alpha"]
    expect(alpha).toBeDefined()
    expect(alpha!.started).toBe(2)
    expect(alpha!.completed).toBe(1)
    expect(alpha!.rate).toBeCloseTo(0.5)
  })

  it("uses 'default' team when metadata.teamId is absent", () => {
    const events: WorkflowEvent[] = [
      { eventType: "task_started", taskId: "x1", role: "backend", message: "start" },
      { eventType: "task_completed", taskId: "x1", role: "backend", message: "done" },
    ]
    const result = computeAggregationsFromEvents(events)
    expect(result.successRateByTeam["default"]?.rate).toBe(1)
  })

  it("computes stall rate from task_started/task_completed pairing", () => {
    const t0 = new Date("2024-01-01T00:00:00.000Z").getTime()
    const t1 = new Date("2024-01-01T00:00:05.000Z").getTime() // 5000ms later
    const events: WorkflowEvent[] = [
      {
        eventType: "task_started",
        taskId: "s1",
        role: "planner",
        message: "start",
        timestamp: new Date(t0).toISOString(),
      },
      {
        eventType: "task_completed",
        taskId: "s1",
        role: "planner",
        message: "done",
        timestamp: new Date(t1).toISOString(),
      },
    ]
    const result = computeAggregationsFromEvents(events)
    const stall = result.stallRateByPosition["planner"]
    expect(stall).toBeDefined()
    expect(stall!.maxWaitMs).toBe(5000)
    expect(stall!.avgWaitMs).toBe(5000)
  })

  it("sums costs by workflowId", () => {
    const events: WorkflowEvent[] = [
      { eventType: "task_completed", taskId: "c1", role: "r", message: "done", metadata: { workflowId: "wf1", cost: 0.05 } },
      { eventType: "task_completed", taskId: "c2", role: "r", message: "done", metadata: { workflowId: "wf1", cost: 0.10 } },
      { eventType: "task_completed", taskId: "c3", role: "r", message: "done", metadata: { workflowId: "wf2", cost: 0.20 } },
    ]
    const result = computeAggregationsFromEvents(events)
    const wf1 = result.costByWorkflow.find((c) => c.workflowId === "wf1")
    const wf2 = result.costByWorkflow.find((c) => c.workflowId === "wf2")
    expect(wf1).toBeDefined()
    expect(wf1!.totalCost).toBeCloseTo(0.15)
    expect(wf2!.totalCost).toBeCloseTo(0.20)
  })

  it("ignores events without cost in cost aggregation", () => {
    const events: WorkflowEvent[] = [
      { eventType: "task_completed", taskId: "nc1", role: "r", message: "done" },
      { eventType: "task_completed", taskId: "nc2", role: "r", message: "done", metadata: { cost: 0 } },
    ]
    const result = computeAggregationsFromEvents(events)
    expect(result.costByWorkflow).toEqual([])
  })

  it("computes duration avg and p95 by stage", () => {
    // 10 events with durations 10..100 ms for stage "planning"
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const events: WorkflowEvent[] = durations.map((d, i) => ({
      eventType: "task_completed" as const,
      taskId: `d${i}`,
      role: "backend",
      message: "done",
      durationMs: d,
      metadata: { stage: "planning" },
    }))
    const result = computeAggregationsFromEvents(events)
    const planning = result.durationByStage["planning"]
    expect(planning).toBeDefined()
    expect(planning!.count).toBe(10)
    expect(planning!.avgMs).toBe(55) // (10+20+...+100)/10 = 550/10
    // p95 of [10..100] sorted, idx = floor(10 * 0.95) = 9 => 100
    expect(planning!.p95Ms).toBe(100)
  })

  it("p95 calculation is correct for varied durations", () => {
    // 20 values 1..20
    const durations = Array.from({ length: 20 }, (_, i) => i + 1)
    const events: WorkflowEvent[] = durations.map((d, i) => ({
      eventType: "task_completed" as const,
      taskId: `p${i}`,
      role: "r",
      message: "done",
      durationMs: d,
      metadata: { stage: "execution" },
    }))
    const result = computeAggregationsFromEvents(events)
    const execution = result.durationByStage["execution"]
    // p95 idx = floor(20 * 0.95) = 19 => value at index 19 in sorted [1..20] = 20
    expect(execution!.p95Ms).toBe(20)
    expect(execution!.count).toBe(20)
  })
})
