import { test, expect } from "bun:test"
import { transformVSCodeMessages, type VSCodeMessage } from "../../src/cli/cmd/import-vscode"

// transformVSCodeMessages tests
test("transforms VS Code messages to Kilo format", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "Hello", ts: 1704067200000 },
    { type: "say", say: "text", text: "Hi there!", ts: 1704067260000 },
  ]
  
  const result = transformVSCodeMessages(messages, "test-session-123", "proj-456")
  
  expect(result.info.id).toBe("ses_test-session-123")
  expect(result.info.projectID).toBe("proj-456")
  expect(result.info.slug).toBe("vscode-test-ses")
  expect(result.messages).toHaveLength(2)
  expect(result.messages[0].info.role).toBe("user")
  expect(result.messages[1].info.role).toBe("assistant")
  expect(result.messages[0].parts[0].text).toBe("Hello")
  expect(result.messages[1].parts[0].text).toBe("Hi there!")
})

test("filters non-text messages", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "Keep this" },
    { type: "say", say: "command", text: "Skip this" },
    { type: "command", text: "Skip this too" },
  ]
  
  const result = transformVSCodeMessages(messages, "session-1", "proj-1")
  
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts[0].text).toBe("Keep this")
})

test("generates sequential IDs", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "First" },
    { type: "say", say: "text", text: "Second" },
    { type: "say", say: "text", text: "Third" },
  ]
  
  const result = transformVSCodeMessages(messages, "s", "p")
  
  expect(result.messages[0].info.id).toBe("msg_0001")
  expect(result.messages[1].info.id).toBe("msg_0002")
  expect(result.messages[2].info.id).toBe("msg_0003")
  expect(result.messages[0].parts[0].id).toBe("prt_0001")
})

test("handles empty messages", () => {
  const messages: VSCodeMessage[] = []
  
  const result = transformVSCodeMessages(messages, "s", "p")
  
  expect(result.messages).toHaveLength(0)
  expect(result.info.id).toBe("ses_s")
})

test("handles messages without timestamp", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "No timestamp" },
  ]
  
  const result = transformVSCodeMessages(messages, "s", "p")
  
  expect(result.messages[0].info.time.created).toBeGreaterThan(0)
})

test("sets correct permission structure", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "Test" },
  ]
  
  const result = transformVSCodeMessages(messages, "s", "p")
  
  expect(result.info.permission).toHaveLength(3)
  expect(result.info.permission[0].permission).toBe("question")
  expect(result.info.permission[0].action).toBe("deny")
})

test("includes proper model configuration", () => {
  const messages: VSCodeMessage[] = [
    { type: "say", say: "text", text: "Test" },
  ]
  
  const result = transformVSCodeMessages(messages, "s", "p")
  
  expect(result.messages[0].info.model.providerID).toBe("kilo")
  expect(result.messages[0].info.model.modelID).toBe("z-ai/glm-5:free")
})
