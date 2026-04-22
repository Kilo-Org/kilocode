/**
 * ApiKeyScannerService - Discovers API keys from common locations
 * 
 * Scans:
 * - C:\Users\Admin\Downloads\api\*.env files
 * - Environment variables
 * - Common .env file locations
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

export interface DiscoveredKey {
  key: string
  source: string
  type: "azure" | "siliconflow" | "minimax" | "github" | "huggingface" | "google" | "openai" | "elevenlabs" | "unknown"
}

export interface ScanResult {
  azure: {
    apiKey: string | null
    region: string | null
  }
  siliconflow: string[]
  minimax: string | null
  github: string | null
  huggingface: string | null
  google: string | null
  openai: string | null
  elevenlabs: string | null
  polly: {
    accessKeyId: string | null
    secretAccessKey: string | null
    region: string | null
  }
}

const API_DOWNLOADS_PATH = path.join(os.homedir(), "Downloads", "api")

export class ApiKeyScannerService {
  /**
   * Scan all known locations for API keys
   */
  static scan(): ScanResult {
    return {
      azure: this.scanAzure(),
      siliconflow: this.scanSiliconFlow(),
      minimax: this.scanMinimax(),
      github: this.scanGithub(),
      huggingface: this.scanHuggingFace(),
      google: this.scanGoogle(),
      openai: this.scanOpenAI(),
      elevenlabs: this.scanElevenLabs(),
      polly: this.scanPolly(),
    }
  }

  /**
   * Check if any API keys are discovered
   */
  static hasKeys(): boolean {
    const result = this.scan()
    return !!(
      result.azure.apiKey ||
      result.siliconflow.length > 0 ||
      result.minimax ||
      result.github ||
      result.huggingface ||
      result.google ||
      result.openai ||
      result.elevenlabs ||
      result.polly.accessKeyId
    )
  }

  /**
   * Get a summary of discovered keys (without exposing the actual keys)
   */
  static getDiscoverySummary(): Record<string, boolean> {
    const result = this.scan()
    return {
      azure: !!result.azure.apiKey,
      siliconflow: result.siliconflow.length > 0,
      minimax: !!result.minimax,
      github: !!result.github,
      huggingface: !!result.huggingface,
      google: !!result.google,
      openai: !!result.openai,
      elevenlabs: !!result.elevenlabs,
      polly: !!result.polly.accessKeyId,
    }
  }

  private static scanAzure(): { apiKey: string | null; region: string | null } {
    // Check environment variable first
    const envKey = process.env.AZURE_SPEECH_KEY || process.env.VITE_AZURE_SPEECH_KEY
    const envRegion = process.env.AZURE_SPEECH_REGION

    if (envKey) {
      return { apiKey: envKey, region: envRegion || "westus" }
    }

    // Scan C:\Users\Admin\Downloads\api\ directory
    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      // Scan all .env files
      const envFiles = fs.readdirSync(apiDir).filter(f => f.startsWith(".env") || f.endsWith(".env"))
      
      for (const file of envFiles) {
        const content = fs.readFileSync(path.join(apiDir, file), "utf-8")
        const key = this.extractValue(content, ["AZURE_SPEECH_KEY", "VITE_AZURE_SPEECH_KEY"])
        const region = this.extractValue(content, ["AZURE_SPEECH_REGION"])
        
        if (key) {
          return { apiKey: key, region: region || "westus" }
        }
      }

      // Also check Azure.txt
      const azureTxt = path.join(apiDir, "env", "Azure.txt")
      if (fs.existsSync(azureTxt)) {
        const content = fs.readFileSync(azureTxt, "utf-8")
        const key = this.extractValue(content, ["AZURE_SPEECH_KEY"])
        const region = this.extractValue(content, ["AZURE_SPEECH_REGION"])
        if (key) {
          return { apiKey: key, region: region || "westus" }
        }
      }
    }

    return { apiKey: null, region: null }
  }

  private static scanSiliconFlow(): string[] {
    const keys: string[] = []

    // Check environment
    const envKey = process.env.SILICONFLOW_API_KEY
    if (envKey) {
      keys.push(envKey)
    }

    // Scan downloads/api directory
    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const files = [
        ".env.contract-kit",
        ".env",
        "siliconflow.txt",
        path.join("env", ".env.secret"),
        path.join("env", ".env.vps"),
      ]

      for (const file of files) {
        const filePath = path.join(apiDir, file)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8")
          const found = this.extractValues(content, ["SILICONFLOW_API_KEY", "SILICONFLOW_API_KEY_2"])
          keys.push(...found)
        }
      }
    }

    // Return unique keys
    return [...new Set(keys)].filter(k => k && k.length > 10)
  }

  private static scanMinimax(): string | null {
    // Check environment
    const envKey = process.env.MINIMAX_API_KEY
    if (envKey) {
      return envKey
    }

    // Scan downloads/api directory
    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const files = [
        ".env.contract-kit",
        "minimax.txt",
        path.join("env", "minimax.env"),
      ]

      for (const file of files) {
        const filePath = path.join(apiDir, file)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8")
          const key = this.extractValue(content, ["MINIMAX_API_KEY"])
          if (key) {
            return key
          }
        }
      }
    }

    return null
  }

  private static scanGithub(): string | null {
    // Check environment
    const envKey = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (envKey) {
      return envKey
    }

    // Scan downloads/api directory
    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const files = [
        ".env.contract-kit",
        ".env.github",
        "github.txt",
      ]

      for (const file of files) {
        const filePath = path.join(apiDir, file)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8")
          // Look for github tokens (ghp_, gho_, ghu_, ghs_, ghr_)
          const key = this.extractGithubToken(content)
          if (key) {
            return key
          }
        }
      }
    }

    return null
  }

  private static scanHuggingFace(): string | null {
    // Check environment
    const envKey = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN
    if (envKey) {
      return envKey
    }

    // Scan downloads/api directory
    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const files = [
        ".env.contract-kit",
        "hf-token.txt",
      ]

      for (const file of files) {
        const filePath = path.join(apiDir, file)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8")
          const key = this.extractValue(content, ["HF_TOKEN", "HUGGINGFACE_TOKEN"])
          if (key) {
            return key
          }
        }
      }
    }

    return null
  }

  private static scanGoogle(): string | null {
    const envKey = process.env.GOOGLE_API_KEY || process.env.GCLOUD_API_KEY
    if (envKey) {
      return envKey
    }

    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const content = fs.readFileSync(path.join(apiDir, ".env"), "utf-8")
      return this.extractValue(content, ["GOOGLE_API_KEY", "GCLOUD_API_KEY"])
    }

    return null
  }

  private static scanOpenAI(): string | null {
    const envKey = process.env.OPENAI_API_KEY
    if (envKey) {
      return envKey
    }

    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const content = fs.readFileSync(path.join(apiDir, ".env"), "utf-8")
      return this.extractValue(content, ["OPENAI_API_KEY"])
    }

    return null
  }

  private static scanElevenLabs(): string | null {
    const envKey = process.env.ELEVENLABS_API_KEY
    if (envKey) {
      return envKey
    }

    const apiDir = API_DOWNLOADS_PATH
    if (fs.existsSync(apiDir)) {
      const content = fs.readFileSync(path.join(apiDir, ".env"), "utf-8")
      return this.extractValue(content, ["ELEVENLABS_API_KEY"])
    }

    return null
  }

  private static scanPolly(): { accessKeyId: string | null; secretAccessKey: string | null; region: string | null } {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.POLLY_ACCESS_KEY_ID
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.POLLY_SECRET_ACCESS_KEY
    const region = process.env.AWS_REGION || process.env.POLLY_REGION || "us-east-1"

    if (accessKeyId) {
      return { accessKeyId, secretAccessKey: secretKey ?? null, region }
    }

    return { accessKeyId: null, secretAccessKey: null, region: null }
  }

  /**
   * Extract a value for a given key from .env content
   */
  private static extractValue(content: string, keys: string[]): string | null {
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      for (const key of keys) {
        if (trimmed.startsWith(`${key}=`)) {
          const value = trimmed.substring(key.length + 1).trim()
          // Remove quotes if present
          return value.replace(/^["']|["']$/g, "")
        }
      }
    }
    return null
  }

  /**
   * Extract multiple values for a given key from .env content
   */
  private static extractValues(content: string, keys: string[]): string[] {
    const values: string[] = []
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      for (const key of keys) {
        if (trimmed.startsWith(`${key}=`)) {
          const value = trimmed.substring(key.length + 1).trim().replace(/^["']|["']$/g, "")
          if (value) {
            values.push(value)
          }
        }
      }
    }
    return values
  }

  /**
   * Extract GitHub token from content
   */
  private static extractGithubToken(content: string): string | null {
    const lines = content.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip comments and empty lines
      if (trimmed.startsWith("#") || !trimmed) continue
      
      // Check for GITHUB_TOKEN= or just the token directly
      if (trimmed.startsWith("GITHUB_TOKEN=")) {
        return trimmed.substring("GITHUB_TOKEN=".length).trim().replace(/^["']|["']$/g, "")
      }
      
      // Check for keys starting with ghp_, gho_, ghu_, ghs_, ghr_
      if (trimmed.match(/^(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]+$/)) {
        return trimmed
      }
    }
    return null
  }
}