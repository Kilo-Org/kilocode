import { describe, expect, it } from "bun:test"
import { serialize } from "../../src/util/serialize"

type Tuple = Parameters<typeof serialize>[0]

const scalars = [
  [0n, '[["bigint","0"]]', '["0:0"]'],
  [9007199254740992n, '[["bigint","9007199254740992"]]', '["0:9007199254740992"]'],
  [9007199254740993n, '[["bigint","9007199254740993"]]', '["0:9007199254740993"]'],
  [-9007199254740992n, '[["bigint","-9007199254740992"]]', '["0:-9007199254740992"]'],
  [-9007199254740993n, '[["bigint","-9007199254740993"]]', '["0:-9007199254740993"]'],
  [false, '[["boolean","false"]]', '["1:false"]'],
  [true, '[["boolean","true"]]', '["1:true"]'],
  [0, '[["number","0"]]', '["2:0"]'],
  [-0, '[["number","-0"]]', '["2:-0"]'],
  [NaN, '[["number","NaN"]]', '["2:NaN"]'],
  [Infinity, '[["number","Infinity"]]', '["2:Infinity"]'],
  [-Infinity, '[["number","-Infinity"]]', '["2:-Infinity"]'],
  [0.5, '[["number","0.5"]]', '["2:0.5"]'],
  [-0.5, '[["number","-0.5"]]', '["2:-0.5"]'],
  [Number.MIN_VALUE, '[["number","5e-324"]]', '["2:5e-324"]'],
  [Number.MAX_VALUE, '[["number","1.7976931348623157e+308"]]', '["2:1.7976931348623157e+308"]'],
  [1e-7, '[["number","1e-7"]]', '["2:1e-7"]'],
  [1e21, '[["number","1e+21"]]', '["2:1e+21"]'],
  ["", '[["string",""]]', '["3:"]'],
  ["0", '[["string","0"]]', '["3:0"]'],
  ["undefined", '[["string","undefined"]]', '["3:undefined"]'],
  ["null", '[["string","null"]]', '["3:null"]'],
  ["NaN", '[["string","NaN"]]', '["3:NaN"]'],
  ["Infinity", '[["string","Infinity"]]', '["3:Infinity"]'],
  ["-Infinity", '[["string","-Infinity"]]', '["3:-Infinity"]'],
  ["number", '[["string","number"]]', '["3:number"]'],
  ["2:0", '[["string","2:0"]]', '["3:2:0"]'],
  ["3:2:0", '[["string","3:2:0"]]', '["3:3:2:0"]'],
  [
    '"quoted":\\\0\n\r\t',
    String.raw`[["string","\"quoted\":\\\u0000\n\r\t"]]`,
    String.raw`["3:\"quoted\":\\\u0000\n\r\t"]`,
  ],
  ["é漢𝄞", '[["string","é漢𝄞"]]', '["3:é漢𝄞"]'],
  ["\ud800", '[["string","\\ud800"]]', '["3:\\ud800"]'],
  ["\udfff", '[["string","\\udfff"]]', '["3:\\udfff"]'],
  [null, '[["object","null"]]', '["4:null"]'],
  [undefined, '[["undefined","undefined"]]', '["5:undefined"]'],
] as const

describe("serialize", () => {
  it("preserves text boundaries and nested tuples", () => {
    expect(serialize(["a:b", "c"])).not.toBe(serialize(["a", "b:c"]))
    expect(serialize(["a\0b", "c"])).not.toBe(serialize(["a", "b\0c"]))
    expect(serialize([["a", "b"]])).not.toBe(serialize(["a", "b"]))
  })

  it("preserves scalar types and exact BigInt values", () => {
    const values = [1, 1n, "1", null, undefined, "", true, "true", 0, -0, NaN, Infinity, -Infinity]
    expect(new Set(values.map((value) => serialize([value]))).size).toBe(values.length)
    expect(serialize([9007199254740992n])).not.toBe(serialize([9007199254740993n]))
  })

  it.each(scalars)("compacts scalar %p against its captured legacy key", (value, legacy, key) => {
    const result = serialize([value])
    const savings = (typeof value).length + 3
    expect(result).toBe(key)
    expect(result.length).toBe(legacy.length - savings)
    expect(Buffer.byteLength(result, "utf8")).toBe(Buffer.byteLength(legacy, "utf8") - savings)
  })

  it("keeps every scalar fixture distinct", () => {
    expect(new Set(scalars.map(([value]) => serialize([value]))).size).toBe(scalars.length)
  })

  it("distinguishes scalar leaves, arrays, and sparse positions", () => {
    const fixtures = [
      [[], "[]"],
      [[[]], "[[]]"],
      [[[[]]], "[[[]]]"],
      [Array<Tuple[number]>(1), "[null]"],
      [[null], '["4:null"]'],
      [[undefined], '["5:undefined"]'],
      [[Array<Tuple[number]>(1)], "[[null]]"],
      [[[null]], '[["4:null"]]'],
      [[[undefined]], '[["5:undefined"]]'],
      [[, 0], '[null,"2:0"]'],
      [[0, , 1], '["2:0",null,"2:1"]'],
      [[0, ,], '["2:0",null]'],
      [[[0, ,]], '[["2:0",null]]'],
      [[0, , "0", ,], '["2:0",null,"3:0",null]'],
      [[Array<Tuple[number]>(1), undefined], '[[null],"5:undefined"]'],
      [[["number", "0"]], '[["3:number","3:0"]]'],
      [[["object", "null"]], '[["3:object","3:null"]]'],
      [[["undefined", "undefined"]], '[["3:undefined","3:undefined"]]'],
      [[["2:0"]], '[["3:2:0"]]'],
    ] satisfies [Tuple, string][]
    for (const [tuple, key] of fixtures) expect(serialize(tuple)).toBe(key)
    expect(new Set(fixtures.map(([tuple]) => serialize(tuple))).size).toBe(fixtures.length)
  })

  it("preserves the deterministic sparse tuple corpus", () => {
    const values = [null, undefined, 0, -0, 0n, "0", false, []] satisfies Tuple
    const choices = [Array<Tuple[number]>(1), ...values.map((value) => [value])]
    const tuples: Tuple[] = [[], ...choices, ...choices.flatMap((left) => choices.map((right) => left.concat(right)))]
    const corpus = tuples.flatMap((tuple) => [
      tuple,
      tuple.slice(),
      [tuple],
      [[tuple]],
      [tuple, tuple],
      [tuple.slice(), tuple.slice()],
    ])
    expect(tuples).toHaveLength(91)
    expect(new Set(tuples.map(serialize)).size).toBe(91)
    expect(corpus).toHaveLength(546)
    expect(new Set(corpus.map(serialize)).size).toBe(361)
    for (const tuple of tuples) {
      expect(serialize(tuple.slice())).toBe(serialize(tuple))
      expect(serialize([tuple, tuple])).toBe(serialize([tuple.slice(), tuple.slice()]))
    }
  })

  it("ignores allocations and shared versus copied children", () => {
    const child = ["a:b", [0, -0, undefined]] as const
    expect(serialize([child, child])).toBe(
      serialize([
        ["a:b", [0, -0, undefined]],
        ["a:b", [0, -0, undefined]],
      ]),
    )
  })

  it("reduces the representative tuple from 94 to 40 characters and bytes", () => {
    const legacy = '[["number","0"],["number","-0"],["bigint","0"],[["number","1"],["number","2"],["number","3"]]]'
    const key = serialize([0, -0, 0n, [1, 2, 3]])
    expect(key).toBe('["2:0","2:-0","0:0",["2:1","2:2","2:3"]]')
    expect(legacy.length).toBe(94)
    expect(Buffer.byteLength(legacy, "utf8")).toBe(94)
    expect(key.length).toBe(40)
    expect(Buffer.byteLength(key, "utf8")).toBe(40)
  })

  it("keeps the same scalar savings under deep singleton nesting", () => {
    const tuple = Array.from({ length: 128 }).reduce<Tuple>((tuple) => [tuple], [0])
    const legacy = `${"[".repeat(128)}[["number","0"]]${"]".repeat(128)}`
    const key = serialize(tuple)
    expect(legacy.length).toBe(272)
    expect(key.length).toBe(263)
    expect(Buffer.byteLength(key, "utf8")).toBe(Buffer.byteLength(legacy, "utf8") - 9)
  })

  it("leaves array and hole-only legacy keys byte-for-byte unchanged", () => {
    const fixtures = [
      [[], "[]"],
      [[[]], "[[]]"],
      [[[[]]], "[[[]]]"],
      [Array<Tuple[number]>(1), "[null]"],
      [[Array<Tuple[number]>(2)], "[[null,null]]"],
      [[[], Array<Tuple[number]>(1), [Array<Tuple[number]>(2)]], "[[],[null],[[null,null]]]"],
      [
        Array.from({ length: 128 }).reduce<Tuple>((tuple) => [tuple], Array<Tuple[number]>(1)),
        `${"[".repeat(128)}[null]${"]".repeat(128)}`,
      ],
    ] satisfies [Tuple, string][]
    for (const [tuple, legacy] of fixtures) {
      const key = serialize(tuple)
      expect(key).toBe(legacy)
      expect(key.length).toBe(legacy.length)
      expect(Buffer.byteLength(key, "utf8")).toBe(Buffer.byteLength(legacy, "utf8"))
    }
  })
})
