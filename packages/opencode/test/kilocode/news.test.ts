import { describe, expect, test } from "bun:test"
import type { KilocodeNotification } from "@kilocode/kilo-gateway"
import { News } from "../../src/kilocode/components/news"

const item = (id: string): KilocodeNotification => ({
  id,
  title: id,
  message: id,
})

describe("News", () => {
  test("shows only notifications that have not been read", () => {
    const items = [item("first"), item("second")]

    expect(News.unread(items, ["first"])).toEqual([items[1]])
    expect(News.unread(items, undefined)).toEqual(items)
    expect(News.unread(items, "invalid")).toEqual(items)
  })

  test("marks every opened notification as read", () => {
    const items = [item("first"), item("second")]
    const read = News.read(items, ["first", "older"])

    expect(read).toEqual(["first", "older", "second"])
    expect(News.unread(items, read)).toEqual([])
    expect(News.unread([...items, item("new")], read)).toEqual([item("new")])
  })

  test("ignores invalid persisted entries", () => {
    expect(News.read([item("first")], [null, 1, "older", "older"])).toEqual(["older", "first"])
  })
})
