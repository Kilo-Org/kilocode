import { describe, expect, test } from "bun:test"
import { preview } from "./board-route"

const sessions = [
  { id: "root", title: "Fix comment UI cutoff issue" },
  { id: "child", parentID: "root", title: "Find PR comment overflow (@explore subagent)" },
  { id: "sibling", parentID: "root", title: "Check serializer compatibility" },
  { id: "orphan", parentID: "missing", title: "Detached" },
]

describe("board route preview", () => {
  test("maps the root session to main and resolves titles", () => {
    expect(preview(sessions, "child", "main")).toEqual({
      from: "child",
      fromLabel: "Find PR comment overflow (@explore subagent)",
      to: "main",
      toLabel: "Fix comment UI cutoff issue",
    })
    expect(preview(sessions, "root", "child")).toEqual({
      from: "main",
      fromLabel: "Fix comment UI cutoff issue",
      to: "child",
      toLabel: "Find PR comment overflow (@explore subagent)",
    })
  })

  test("aliases a recipient given by root ID to main", () => {
    expect(preview(sessions, "child", "root")).toMatchObject({ to: "main", toLabel: "Fix comment UI cutoff issue" })
  })

  test("keeps broadcasts and hides unknown or partial recipient IDs", () => {
    expect(preview(sessions, "child", "ALL")).toMatchObject({ to: "ALL", toLabel: undefined })
    expect(preview(sessions, "child", "sib")).toMatchObject({ to: "", toLabel: undefined })
    expect(preview(sessions, "child", undefined)).toMatchObject({ to: "", toLabel: undefined })
    expect(preview(sessions, "child", "sibling")).toMatchObject({
      to: "sibling",
      toLabel: "Check serializer compatibility",
    })
  })

  test("does not guess main when the lineage is incomplete", () => {
    expect(preview(sessions, "orphan", "main")).toEqual({
      from: "orphan",
      fromLabel: "Detached",
      to: "",
      toLabel: undefined,
    })
    expect(preview([], "unknown", "main")).toEqual({
      from: "unknown",
      fromLabel: undefined,
      to: "",
      toLabel: undefined,
    })
  })
})
