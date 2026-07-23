import { expect, test } from "bun:test"
import path from "node:path"
import {
  indexingProfileLogFields,
  indexingProfileWorkspaceID,
  parseIndexingProfile,
} from "../../src/kilocode/indexing-profile"

test("parses one valid indexing profile record", () => {
  const record = parseIndexingProfile([
    JSON.stringify({
      type: "kilo-indexing-profile",
      event: "indexing.scan.summary",
      durationMs: 12.5,
      outcome: "success",
      fields: { mode: "full", files: 10 },
    }),
  ])

  expect(record?.event).toBe("indexing.scan.summary")
  expect(record?.fields).toEqual({ mode: "full", files: 10 })
})

test("rejects malformed indexing profile records", () => {
  const values: unknown[][] = [
    [],
    ["{"],
    [JSON.stringify({})],
    [JSON.stringify({ type: "wrong", event: "event", durationMs: 1, outcome: "success", fields: {} })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: 1, durationMs: 1, outcome: "success", fields: {} })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: -1, outcome: "success", fields: {} })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: "1", outcome: "success", fields: {} })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: 1, outcome: "unknown", fields: {} })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: 1, outcome: "success", fields: [] })],
    [
      JSON.stringify({
        type: "kilo-indexing-profile",
        event: "event",
        durationMs: 1,
        outcome: "success",
        fields: { nested: {} },
      }),
    ],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: 1, outcome: "success", fields: { none: null } })],
    [JSON.stringify({ type: "kilo-indexing-profile", event: "event", durationMs: 1, outcome: "success", fields: {} }), "extra"],
  ]

  for (const args of values) expect(parseIndexingProfile(args)).toBeUndefined()
})

test("normalizes equivalent workspace paths before hashing", () => {
  const directory = ".indexing-profile-workspace"
  const resolved = path.resolve(directory)

  expect(indexingProfileWorkspaceID(directory)).toBe(indexingProfileWorkspaceID(resolved))
})

test("routes only aggregate profile fields with authoritative metadata", () => {
  const directory = "/private/example/workspace"
  const record = parseIndexingProfile([
    JSON.stringify({
      type: "kilo-indexing-profile",
      event: "indexing.scan.summary",
      durationMs: 12.5,
      outcome: "success",
      fields: {
        mode: "full",
        files: 10,
        blockCount: 2,
        source: "profile",
        workspaceID: "profile",
        event: "profile",
        durationMs: 0,
        outcome: "error",
        workspacePath: "/private/example/workspace",
        path: "/private/example/file.ts",
        query: "sensitive-query",
        code: "const secret = true",
        url: "https://example.com/private",
        hash: "abc123",
        credential: "token",
        organizationId: "org-private",
        error: "failed",
        pointID: "point-private",
        collectionName: "collection-private",
      },
    }),
  ])

  const id = indexingProfileWorkspaceID(directory)
  expect(id).toMatch(/^[a-f0-9]{16}$/)
  expect(id).toBe(indexingProfileWorkspaceID(directory))
  expect(id).not.toContain("workspace")
  expect(record).toBeDefined()

  const fields = indexingProfileLogFields(directory, record!)
  expect(fields).toEqual({
    mode: "full",
    files: 10,
    blockCount: 2,
    source: "worker",
    workspaceID: id,
    event: "indexing.scan.summary",
    durationMs: 12.5,
    outcome: "success",
  })
  expect(Object.keys(fields)).toEqual([
    "mode",
    "files",
    "blockCount",
    "source",
    "workspaceID",
    "event",
    "durationMs",
    "outcome",
  ])
  for (const key of [
    "workspacePath",
    "path",
    "query",
    "code",
    "url",
    "hash",
    "credential",
    "organizationId",
    "error",
    "pointID",
    "collectionName",
  ]) {
    expect(fields[key]).toBeUndefined()
  }
})
