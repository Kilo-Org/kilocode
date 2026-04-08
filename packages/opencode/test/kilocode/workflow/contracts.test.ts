import { describe, test, expect } from "bun:test"
import {
  FieldSpec,
  APIContract,
  TypeContract,
  IntegrationHint,
  ContractSet,
  contractsForTask,
  formatContractsForAgent,
  formatContractsForReviewer,
} from "@/devilcode/workflow/contracts"

describe("FieldSpec", () => {
  test("parses valid field", () => {
    const result = FieldSpec.parse({ name: "id", type: "string", required: true, description: "Unique ID" })
    expect(result.name).toBe("id")
    expect(result.type).toBe("string")
    expect(result.required).toBe(true)
  })

  test("defaults required to true", () => {
    const result = FieldSpec.parse({ name: "id", type: "string" })
    expect(result.required).toBe(true)
  })
})

describe("APIContract", () => {
  test("parses full contract", () => {
    const result = APIContract.parse({
      id: "contract-api-1",
      method: "POST",
      path: "/api/users",
      description: "Create user",
      requestBody: [{ name: "email", type: "string" }],
      responseBody: [{ name: "id", type: "string" }, { name: "email", type: "string" }],
      responseExample: '{"id":"abc","email":"a@b.com"}',
      producerTaskId: "T-001",
      consumerTaskIds: ["T-002", "T-003"],
    })
    expect(result.id).toBe("contract-api-1")
    expect(result.producerTaskId).toBe("T-001")
    expect(result.consumerTaskIds).toEqual(["T-002", "T-003"])
  })
})

describe("TypeContract", () => {
  test("parses shared type contract", () => {
    const result = TypeContract.parse({
      name: "UserProfile",
      description: "A user profile",
      fieldSpecs: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
      ],
      usedByTasks: ["T-001", "T-002"],
    })
    expect(result.name).toBe("UserProfile")
    expect(result.fieldSpecs).toHaveLength(2)
  })
})

describe("ContractSet", () => {
  const set: ContractSet = {
    apiContracts: [
      {
        id: "api-1",
        method: "GET",
        path: "/api/items",
        description: "List items",
        requestBody: null,
        responseBody: [{ name: "items", type: "Item[]", required: true, description: "" }],
        responseExample: "",
        producerTaskId: "T-001",
        consumerTaskIds: ["T-002"],
      },
    ],
    typeContracts: [
      {
        name: "Item",
        description: "An item",
        fieldSpecs: [{ name: "id", type: "string", required: true, description: "" }],
        usedByTasks: ["T-001", "T-002"],
      },
    ],
    integrationHints: [],
  }

  test("contractsForTask returns producing and consuming", () => {
    const tc = contractsForTask(set, "T-001")
    expect(tc.producing).toHaveLength(1)
    expect(tc.consuming).toHaveLength(0)
    expect(tc.types).toHaveLength(1)
  })

  test("contractsForTask returns consuming for consumer", () => {
    const tc = contractsForTask(set, "T-002")
    expect(tc.producing).toHaveLength(0)
    expect(tc.consuming).toHaveLength(1)
    expect(tc.types).toHaveLength(1)
  })

  test("formatContractsForAgent includes API details", () => {
    const tc = contractsForTask(set, "T-001")
    const text = formatContractsForAgent(tc)
    expect(text).toContain("PRODUCE")
    expect(text).toContain("GET /api/items")
  })

  test("formatContractsForReviewer includes compliance check", () => {
    const tc = contractsForTask(set, "T-001")
    const text = formatContractsForReviewer(tc)
    expect(text).toContain("Contract Compliance")
    expect(text).toContain("FAIL the review")
  })
})
