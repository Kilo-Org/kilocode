/**
 * json-rpc.ts — JSON-RPC 2.0 protocol types + framing
 * Inspired by MCP SDK (MIT)
 * Deps: none
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id?: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg
}

export function createRequest(method: string, params?: unknown, id?: number): JsonRpcRequest {
  return { jsonrpc: "2.0", id: id ?? Date.now(), method, params }
}

export function createResponse(id: string | number | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

export function createError(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

export class LineFramer {
  private buf = ""
  push(chunk: string): JsonRpcMessage[] {
    this.buf += chunk
    const out: JsonRpcMessage[] = []
    let idx: number
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (line) try { out.push(JSON.parse(line)) } catch { /* skip */ }
    }
    return out
  }
}

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603
