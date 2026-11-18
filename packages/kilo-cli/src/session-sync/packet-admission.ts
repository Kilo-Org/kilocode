import { fail, jsonNodes, limits, type Change, type Failure } from "./protocol"

type PacketSize = { bytes: number; nodes: number }
type Admission =
  | { type: "include"; size: PacketSize }
  | { type: "finish" }
  | { type: "reject"; error: Failure }

export function admitChange(size: PacketSize, count: number, op: Change["op"], changes: readonly Change[]): Admission {
  // An oversized put group is rejected even when there is already a prefix to freeze.
  if (op === "put" && changes.length > limits.changes)
    return {
      type: "reject",
      error: fail("asset_limit", "One native entity requires more assets than the service packet limit"),
    }

  const bytes = size.bytes + Buffer.byteLength(JSON.stringify(changes)) - 2 + (count ? 1 : 0)
  const groupNodes = jsonNodes(changes, limits.jsonBatchDepth - 1, limits.jsonBatchNodes)
  const nodes = groupNodes === undefined ? undefined : size.nodes + groupNodes - 1
  // The raw JSON bound applies to both groups. Only an initial put also enforces the node reserve.
  if (nodes === undefined || (op === "put" && count === 0 && nodes > limits.jsonBatchNodes))
    return {
      type: "reject",
      error: fail(
        "packet_too_large",
        op === "remove"
          ? "One portable removal exceeds the service JSON budget"
          : "One portable entity and its assets exceed the service JSON budget",
      ),
    }

  // Reserve room for the envelope and identities. Finish only between whole native entities.
  const overPacket = count + changes.length > limits.changes || bytes > limits.batch - 4096
  if (count && (overPacket || nodes > limits.jsonBatchNodes)) return { type: "finish" }
  if (overPacket)
    return {
      type: "reject",
      error: fail(
        "packet_too_large",
        op === "remove"
          ? "One portable removal exceeds the service packet limit"
          : "One portable entity and its asset mappings exceed the service packet limit",
      ),
    }
  return { type: "include", size: { bytes, nodes } }
}
