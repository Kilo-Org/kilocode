/**
 * SettingsAgentAPI - Agent-accessible settings completion API
 * 
 * This API allows agents (via Hermes CLI/gateway) to:
 * - Query current settings state
 * - Discover available API keys
 * - Auto-fill settings from discovered keys
 * - Update settings with recommended values
 * - Get suggestions for optimal settings
 */

import * as vscode from "vscode"
import { ApiKeyScannerService, type ScanResult } from "./ApiKeyScannerService"

export interface SettingsStatus {
  speech: {
    provider: string
    azureConfigured: boolean
    googleConfigured: boolean
    openaiConfigured: boolean
    elevenlabsConfigured: boolean
    pollyConfigured: boolean
  }
  providers: {
    siliconflow: string[]
    minimax: string | null
    github: string | null
    huggingface: string | null
  }
  training: {
    huggingfaceToken: string | null
  }
}

export interface AutoFillRequest {
  setting: "speech.azure" | "speech.google" | "speech.openai" | "speech.elevenlabs" | 
           "speech.polly" | "provider.siliconflow" | "provider.minimax" | 
           "provider.github" | "training.huggingface"
  value?: string  // Optional specific value
}

export interface AutoFillResult {
  success: boolean
  setting: string
  value?: string
  error?: string
}

export interface SettingsSuggestion {
  category: string
  setting: string
  currentValue: unknown
  suggestedValue: unknown
  reason: string
}

export class SettingsAgentAPI {
  private context: vscode.ExtensionContext

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  /**
   * Get current settings status - what is configured vs what could be auto-filled
   */
  async getSettingsStatus(): Promise<SettingsStatus> {
    const scanResult = ApiKeyScannerService.scan()
    
    // Get current speech settings
    const speechConfig = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const speechProvider = speechConfig.get<string>("provider", "browser")
    
    return {
      speech: {
        provider: speechProvider,
        azureConfigured: !!(scanResult.azure.apiKey),
        googleConfigured: !!(scanResult.google),
        openaiConfigured: !!(scanResult.openai),
        elevenlabsConfigured: !!(scanResult.elevenlabs),
        pollyConfigured: !!(scanResult.polly.accessKeyId),
      },
      providers: {
        siliconflow: scanResult.siliconflow,
        minimax: scanResult.minimax,
        github: scanResult.github,
        huggingface: scanResult.huggingface,
      },
      training: {
        huggingfaceToken: scanResult.huggingface,
      },
    }
  }

  /**
   * Discover available API keys from common locations
   */
  async discoverApiKeys(): Promise<ScanResult> {
    return ApiKeyScannerService.scan()
  }

  /**
   * Get a summary of what keys are available (without exposing the actual keys)
   */
  async getDiscoverySummary(): Promise<Record<string, boolean>> {
    return ApiKeyScannerService.getDiscoverySummary()
  }

  /**
   * Auto-fill a specific setting from discovered API keys
   */
  // eslint-disable-next-line complexity
  async autoFillSetting(request: AutoFillRequest): Promise<AutoFillResult> {
    const scanResult = ApiKeyScannerService.scan()

    try {
      switch (request.setting) {
        case "speech.azure":
          if (!scanResult.azure.apiKey) {
            return { success: false, setting: request.setting, error: "No Azure API key found" }
          }
          await this.updateSetting("kilo-code.new.speech", "azure.apiKey", scanResult.azure.apiKey)
          if (scanResult.azure.region) {
            await this.updateSetting("kilo-code.new.speech", "azure.region", scanResult.azure.region)
          }
          await this.updateSetting("kilo-code.new.speech", "provider", "azure")
          return { success: true, setting: request.setting, value: scanResult.azure.apiKey.substring(0, 8) + "..." }

        case "speech.google":
          if (!scanResult.google) {
            return { success: false, setting: request.setting, error: "No Google API key found" }
          }
          await this.updateSetting("kilo-code.new.speech", "google.apiKey", scanResult.google)
          return { success: true, setting: request.setting, value: scanResult.google.substring(0, 8) + "..." }

        case "speech.openai":
          if (!scanResult.openai) {
            return { success: false, setting: request.setting, error: "No OpenAI API key found" }
          }
          await this.updateSetting("kilo-code.new.speech", "openai.apiKey", scanResult.openai)
          return { success: true, setting: request.setting, value: scanResult.openai.substring(0, 8) + "..." }

        case "speech.elevenlabs":
          if (!scanResult.elevenlabs) {
            return { success: false, setting: request.setting, error: "No ElevenLabs API key found" }
          }
          await this.updateSetting("kilo-code.new.speech", "elevenlabs.apiKey", scanResult.elevenlabs)
          return { success: true, setting: request.setting, value: scanResult.elevenlabs.substring(0, 8) + "..." }

        case "speech.polly":
          if (!scanResult.polly.accessKeyId) {
            return { success: false, setting: request.setting, error: "No AWS credentials found" }
          }
          await this.updateSetting("kilo-code.new.speech", "polly.accessKeyId", scanResult.polly.accessKeyId)
          if (scanResult.polly.secretAccessKey) {
            await this.updateSetting("kilo-code.new.speech", "polly.secretAccessKey", scanResult.polly.secretAccessKey)
          }
          if (scanResult.polly.region) {
            await this.updateSetting("kilo-code.new.speech", "polly.region", scanResult.polly.region)
          }
          return { success: true, setting: request.setting, value: scanResult.polly.accessKeyId.substring(0, 8) + "..." }

        case "provider.siliconflow":
          if (scanResult.siliconflow.length === 0) {
            return { success: false, setting: request.setting, error: "No SiliconFlow API key found" }
          }
          // SiliconFlow is configured via custom provider, return the key info
          return { 
            success: true, 
            setting: request.setting, 
            value: scanResult.siliconflow[0]?.substring(0, 8) + "..." 
          }

        case "provider.minimax":
          if (!scanResult.minimax) {
            return { success: false, setting: request.setting, error: "No MiniMax API key found" }
          }
          return { success: true, setting: request.setting, value: scanResult.minimax.substring(0, 8) + "..." }

        case "provider.github":
          if (!scanResult.github) {
            return { success: false, setting: request.setting, error: "No GitHub token found" }
          }
          return { success: true, setting: request.setting, value: scanResult.github.substring(0, 8) + "..." }

        case "training.huggingface":
          if (!scanResult.huggingface) {
            return { success: false, setting: request.setting, error: "No HuggingFace token found" }
          }
          // Training token is stored in VS Code secret storage
          await this.context.secrets.store("kilo-training-huggingface", scanResult.huggingface)
          return { success: true, setting: request.setting, value: scanResult.huggingface.substring(0, 8) + "..." }

        default:
          return { success: false, setting: request.setting, error: `Unknown setting: ${request.setting}` }
      }
    } catch (error) {
      return { 
        success: false, 
        setting: request.setting, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }
    }
  }

  /**
   * Auto-fill all missing settings at once
   */
  async autoFillAll(): Promise<{ filled: string[]; failed: string[] }> {
    const filled: string[] = []
    const failed: string[] = []

    const settingsToFill = [
      "speech.azure",
      "speech.google", 
      "speech.openai",
      "speech.elevenlabs",
      "speech.polly",
      "provider.github",
      "training.huggingface",
    ]

    for (const setting of settingsToFill) {
      const result = await this.autoFillSetting({ setting: setting as AutoFillRequest["setting"] })
      if (result.success) {
        filled.push(setting)
      } else {
        failed.push(`${setting}: ${result.error}`)
      }
    }

    return { filled, failed }
  }

  /**
   * Get suggestions for optimal settings based on available keys
   */
  async getSuggestions(): Promise<SettingsSuggestion[]> {
    const scanResult = ApiKeyScannerService.scan()
    const suggestions: SettingsSuggestion[] = []

    // Speech suggestions
    if (scanResult.azure.apiKey && !this.isSettingConfigured("speech", "azure.apiKey")) {
      suggestions.push({
        category: "Speech",
        setting: "speech.azure.apiKey",
        currentValue: null,
        suggestedValue: "[DISCOVERED]",
        reason: "Azure API key found in Downloads/api - recommended for high-quality neural voices",
      })
    }

    if (scanResult.huggingface && !this.isSettingConfigured("speech", "huggingface")) {
      suggestions.push({
        category: "Training",
        setting: "training.huggingface",
        currentValue: null,
        suggestedValue: "[DISCOVERED]",
        reason: "HuggingFace token found - enables model training and deployment",
      })
    }

    if (scanResult.siliconflow.length > 0) {
      suggestions.push({
        category: "Providers",
        setting: "provider.siliconflow",
        currentValue: null,
        suggestedValue: "[DISCOVERED]",
        reason: "SiliconFlow API key(s) found - recommended for cost-effective inference",
      })
    }

    if (scanResult.minimax) {
      suggestions.push({
        category: "Providers",
        setting: "provider.minimax",
        currentValue: null,
        suggestedValue: "[DISCOVERED]",
        reason: "MiniMax API key found - recommended for video generation",
      })
    }

    return suggestions
  }

  /**
   * Update a single setting
   */
  private async updateSetting(section: string, key: string, value: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration(section)
    await config.update(key, value, vscode.ConfigurationTarget.Global)
  }

  /**
   * Check if a setting is already configured
   */
  private isSettingConfigured(section: string, key: string): boolean {
    const config = vscode.workspace.getConfiguration(`kilo-code.new.${section}`)
    const value = config.get(key)
    return value !== undefined && value !== null && value !== ""
  }
}

// Singleton instance
let instance: SettingsAgentAPI | null = null

export function getSettingsAgentAPI(context?: vscode.ExtensionContext): SettingsAgentAPI {
  if (!instance && context) {
    instance = new SettingsAgentAPI(context)
  }
  if (!instance) {
    throw new Error("SettingsAgentAPI not initialized - context required on first call")
  }
  return instance
}

export function initSettingsAgentAPI(context: vscode.ExtensionContext): SettingsAgentAPI {
  instance = new SettingsAgentAPI(context)
  return instance
}