import { describe, expect, test } from "bun:test"
import { extractRelationships } from "../../../../src/indexing/graph/ast-relationships"

describe("AST relationship extraction", () => {
  test("extracts imports from ES6 import statements", () => {
    const code = `
import { useState, useEffect } from "react"
import React from "react"
import * as utils from "./utils"
import "./styles.css"
`
    const tree = mockTree(code)
    const result = extractRelationships(tree, "/test.tsx", "ts")

    expect(result.imports.length).toBeGreaterThanOrEqual(3)
    const reactImport = result.imports.find((i) => i.source === "react")
    expect(reactImport).toBeDefined()
    expect(reactImport?.names).toContain("useState")
    expect(reactImport?.names).toContain("useEffect")
  })

  test("extracts require() calls", () => {
    const code = `
const fs = require("fs")
const path = require("path")
`
    const tree = mockTree(code)
    const result = extractRelationships(tree, "/test.js", "js")

    expect(result.imports.length).toBeGreaterThanOrEqual(2)
    expect(result.imports.some((i) => i.source === "fs")).toBe(true)
    expect(result.imports.some((i) => i.source === "path")).toBe(true)
  })

  test("extracts class extends", () => {
    const code = `
class Animal {}
class Dog extends Animal {}
class Cat extends Animal {}
`
    const tree = mockTree(code)
    const result = extractRelationships(tree, "/test.ts", "ts")

    expect(result.extends.length).toBeGreaterThanOrEqual(2)
    expect(result.extends.some((e) => e.child === "Dog" && e.parent === "Animal")).toBe(true)
    expect(result.extends.some((e) => e.child === "Cat" && e.parent === "Animal")).toBe(true)
  })

  test("extracts function calls", () => {
    const code = `
function helper() {}
function main() {
  helper()
  console.log("hello")
}
`
    const tree = mockTree(code)
    const result = extractRelationships(tree, "/test.ts", "ts")

    expect(result.calls.length).toBeGreaterThanOrEqual(2)
    expect(result.calls.some((c) => c.callee === "helper")).toBe(true)
    expect(result.calls.some((c) => c.callee === "console.log")).toBe(true)
  })

  test("extracts exports", () => {
    const code = `
export function foo() {}
export class Bar {}
export default function main() {}
`
    const tree = mockTree(code)
    const result = extractRelationships(tree, "/test.ts", "ts")

    expect(result.exports.length).toBeGreaterThanOrEqual(2)
    expect(result.exports.some((e) => e.name === "foo")).toBe(true)
    expect(result.exports.some((e) => e.name === "Bar")).toBe(true)
  })
})

// Simple mock tree for testing - in real usage this comes from tree-sitter
function mockTree(code: string): any {
  return {
    rootNode: {
      type: "program",
      text: code,
      startPosition: { row: 0, column: 0 },
      children: [],
      childForFieldName: () => undefined,
    },
  }
}
