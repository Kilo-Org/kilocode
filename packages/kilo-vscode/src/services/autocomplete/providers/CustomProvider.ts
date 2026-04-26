import { ResponseMetaData } from "../types"
import { IAutocompleteProvider } from "../IAutocompleteProvider"

export class CustomProvider implements IAutocompleteProvider {
  constructor(
    private readonly providerName: string,
    private readonly model: string,
    private readonly apiBase: string,
    private readonly apiKey?: string,
  ) {}

  private extractContent(data: any): string | undefined {
    if (data.choices && data.choices.length > 0) {
      const choice = data.choices[0]
      return choice.text ?? choice.delta?.content
    }
    return data.response ?? data.message?.content
  }

  private updateStats(data: any, stats: { inputTokens: number; outputTokens: number }): void {
    if (data.usage) {
      if (data.usage.prompt_tokens !== undefined) stats.inputTokens = data.usage.prompt_tokens
      if (data.usage.completion_tokens !== undefined) stats.outputTokens = data.usage.completion_tokens
    } else if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
      if (data.prompt_eval_count !== undefined) stats.inputTokens = data.prompt_eval_count
      if (data.eval_count !== undefined) stats.outputTokens = data.eval_count
    }
  }

  private parseLine(
    rawLine: string,
    onChunk: (text: string) => void,
    stats: { inputTokens: number; outputTokens: number }
  ): void {
    let raw = rawLine.trim()
    if (raw === "data: [DONE]") return
    if (raw.startsWith("data: ")) {
      raw = raw.slice("data: ".length).trim()
    }
    if (!raw) return

    try {
      const data = JSON.parse(raw)
      const content = this.extractContent(data)

      if (content) onChunk(content)
      this.updateStats(data, stats)
    } catch {
      // Silently ignore parse errors for incomplete JSON or empty lines
    }
  }

  private async processStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (text: string) => void,
    stats: { inputTokens: number; outputTokens: number }
  ) {
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          this.parseLine(line, onChunk, stats)
        }
      }

      if (buffer.trim()) {
        this.parseLine(buffer, onChunk, stats)
      }
    } finally {
      reader.releaseLock()
    }
  }

  private isChatEndpoint(): boolean {
    return this.apiBase.includes("/chat/completions")
  }

  private buildBody(prefix: string, suffix: string): string {
    if (this.isChatEndpoint()) {
      return JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a code completion assistant. You will be given code with a prefix and suffix. " +
              "Output ONLY the code that fills the gap between them. " +
              "Do not include the prefix or suffix. Do not add explanations, markdown, or formatting.",
          },
          {
            role: "user",
            content: `Complete the code between <prefix> and <suffix>. Output ONLY the missing code.\n\n<prefix>\n${prefix}\n</prefix>\n<suffix>\n${suffix}\n</suffix>`,
          },
        ],
        max_tokens: 256,
        temperature: 0.2,
        stream: true,
      })
    }

    return JSON.stringify({
      model: this.model,
      prompt: prefix,
      suffix,
      max_tokens: 256,
      temperature: 0.2,
      stream: true,
    })
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.apiKey) {
      const azure = this.apiBase.toLowerCase().includes("azure")
      if (azure) {
        headers["api-key"] = this.apiKey
      } else {
        headers["Authorization"] = `Bearer ${this.apiKey}`
      }
    }

    return headers
  }

  private async processJsonResponse(
    response: Response,
    onChunk: (text: string) => void,
    stats: { inputTokens: number; outputTokens: number }
  ): Promise<void> {
    const data = await response.json()
    const content = this.extractContent(data)
    if (content) onChunk(content)
    this.updateStats(data, stats)
  }

  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    const url = this.apiBase
    const headers = this.getHeaders()
    const body = this.buildBody(prefix, suffix)

    console.log(`[autocomplete] CustomProvider request → ${url} (model: ${this.model}, chat: ${this.isChatEndpoint()})`)

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      console.error(`[autocomplete] CustomProvider error ${response.status}: ${text}`)
      throw new Error(`Custom provider returned status: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error("No response body from custom provider")
    }

    const stats = { inputTokens: 0, outputTokens: 0 }
    
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      await this.processJsonResponse(response, onChunk, stats)
    } else {
      await this.processStream(response.body.getReader(), onChunk, stats)
    }

    return {
      cost: 0,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    }
  }

  public getModelName(): string {
    return this.model
  }

  public getProviderDisplayName(): string {
    return this.providerName
  }

  public hasValidCredentials(): boolean {
    return true
  }

  public async hasBalance(): Promise<boolean> {
    return true
  }
}
