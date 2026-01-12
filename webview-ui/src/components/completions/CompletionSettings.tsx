// kilocode_change - new file

/**
 * Completion Settings UI Component
 * Provides settings for context-aware completions
 */

import React, { useState, useEffect } from "react"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDivider,
	VSCodeDropdown,
	VSCodeOption,
} from "@vscode/webview-ui-toolkit/react"
import { Settings, Zap, Database, Search, Languages, Trash2, Info } from "lucide-react"

interface CompletionSettingsProps {
	onClose?: () => void
}

interface SettingsState {
	enableContextAware: boolean
	enableSemanticSearch: boolean
	enableNaturalLanguage: boolean
	maxContextFiles: number
	maxContextTokens: number
	semanticThreshold: number
	includeTests: boolean
	includeDependencies: boolean
	cacheEnabled: boolean
	cacheTTL: number
}

export const CompletionSettings: React.FC<CompletionSettingsProps> = ({ onClose }) => {
	const [settings, setSettings] = useState<SettingsState>({
		enableContextAware: true,
		enableSemanticSearch: true,
		enableNaturalLanguage: true,
		maxContextFiles: 50,
		maxContextTokens: 8000,
		semanticThreshold: 0.8,
		includeTests: false,
		includeDependencies: true,
		cacheEnabled: true,
		cacheTTL: 5,
	})

	const [cacheStats, setCacheStats] = useState({ size: 0, maxSize: 100 })
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		loadSettings()
		loadCacheStats()
	}, [])

	const loadSettings = () => {
		// In production, this would load from VSCode configuration
		// For now, use default values
		setSettings({
			enableContextAware: true,
			enableSemanticSearch: true,
			enableNaturalLanguage: true,
			maxContextFiles: 50,
			maxContextTokens: 8000,
			semanticThreshold: 0.8,
			includeTests: false,
			includeDependencies: true,
			cacheEnabled: true,
			cacheTTL: 5,
		})
	}

	const loadCacheStats = async () => {
		try {
			// In production, this would fetch from the completion services
			setCacheStats({ size: 0, maxSize: 100 })
		} catch (error) {
			console.error("Failed to load cache stats:", error)
		}
	}

	const handleSettingChange = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
		setSettings((prev) => ({ ...prev, [key]: value }))
	}

	const handleSave = async () => {
		setLoading(true)
		try {
			// In production, this would save to VSCode configuration
			// For now, just simulate saving
			await new Promise((resolve) => setTimeout(resolve, 500))
			onClose?.()
		} catch (error) {
			console.error("Failed to save settings:", error)
		} finally {
			setLoading(false)
		}
	}

	const handleClearCache = async () => {
		try {
			// In production, this would call the clear cache command
			await new Promise((resolve) => setTimeout(resolve, 500))
			setCacheStats({ size: 0, maxSize: 100 })
		} catch (error) {
			console.error("Failed to clear cache:", error)
		}
	}

	return (
		<div className="completion-settings">
			<div className="settings-header">
				<div className="header-icon">
					<Settings size={24} />
				</div>
				<h2>Completion Settings</h2>
				<p className="subtitle">Configure context-aware code completions</p>
			</div>

			<VSCodeDivider />

			<div className="settings-section">
				<div className="section-header">
					<Zap size={18} />
					<h3>General</h3>
				</div>
				<div className="settings-grid">
					<VSCodeCheckbox
						checked={settings.enableContextAware}
						onChange={(e) =>
							handleSettingChange("enableContextAware", (e.target as HTMLInputElement).checked)
						}>
						Enable Context-Aware Completions
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={settings.enableSemanticSearch}
						onChange={(e) =>
							handleSettingChange("enableSemanticSearch", (e.target as HTMLInputElement).checked)
						}>
						Enable Semantic Search
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={settings.enableNaturalLanguage}
						onChange={(e) =>
							handleSettingChange("enableNaturalLanguage", (e.target as HTMLInputElement).checked)
						}>
						Enable Natural Language to Code
					</VSCodeCheckbox>
				</div>
			</div>

			<VSCodeDivider />

			<div className="settings-section">
				<div className="section-header">
					<Database size={18} />
					<h3>Context Configuration</h3>
				</div>
				<div className="settings-grid">
					<div className="setting-item">
						<label>Max Context Files</label>
						<VSCodeDropdown
							value={settings.maxContextFiles.toString()}
							onChange={(e) =>
								handleSettingChange("maxContextFiles", parseInt((e.target as HTMLSelectElement).value))
							}>
							<VSCodeOption value="10">10 files</VSCodeOption>
							<VSCodeOption value="25">25 files</VSCodeOption>
							<VSCodeOption value="50">50 files</VSCodeOption>
							<VSCodeOption value="100">100 files</VSCodeOption>
						</VSCodeDropdown>
					</div>
					<div className="setting-item">
						<label>Max Context Tokens</label>
						<VSCodeDropdown
							value={settings.maxContextTokens.toString()}
							onChange={(e) =>
								handleSettingChange("maxContextTokens", parseInt((e.target as HTMLSelectElement).value))
							}>
							<VSCodeOption value="4000">4,000 tokens</VSCodeOption>
							<VSCodeOption value="8000">8,000 tokens</VSCodeOption>
							<VSCodeOption value="12000">12,000 tokens</VSCodeOption>
							<VSCodeOption value="16000">16,000 tokens</VSCodeOption>
						</VSCodeDropdown>
					</div>
					<div className="setting-item">
						<label>Semantic Threshold</label>
						<VSCodeDropdown
							value={settings.semanticThreshold.toString()}
							onChange={(e) =>
								handleSettingChange(
									"semanticThreshold",
									parseFloat((e.target as HTMLSelectElement).value),
								)
							}>
							<VSCodeOption value="0.5">0.5 (Low)</VSCodeOption>
							<VSCodeOption value="0.7">0.7 (Medium)</VSCodeOption>
							<VSCodeOption value="0.8">0.8 (High)</VSCodeOption>
							<VSCodeOption value="0.9">0.9 (Very High)</VSCodeOption>
						</VSCodeDropdown>
					</div>
				</div>
			</div>

			<VSCodeDivider />

			<div className="settings-section">
				<div className="section-header">
					<Search size={18} />
					<h3>Search Options</h3>
				</div>
				<div className="settings-grid">
					<VSCodeCheckbox
						checked={settings.includeTests}
						onChange={(e) => handleSettingChange("includeTests", (e.target as HTMLInputElement).checked)}>
						Include Test Files
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={settings.includeDependencies}
						onChange={(e) =>
							handleSettingChange("includeDependencies", (e.target as HTMLInputElement).checked)
						}>
						Include Dependencies
					</VSCodeCheckbox>
				</div>
			</div>

			<VSCodeDivider />

			<div className="settings-section">
				<div className="section-header">
					<Languages size={18} />
					<h3>Cache Settings</h3>
				</div>
				<div className="settings-grid">
					<VSCodeCheckbox
						checked={settings.cacheEnabled}
						onChange={(e) => handleSettingChange("cacheEnabled", (e.target as HTMLInputElement).checked)}>
						Enable Cache
					</VSCodeCheckbox>
					<div className="setting-item">
						<label>Cache TTL (minutes)</label>
						<VSCodeDropdown
							value={settings.cacheTTL.toString()}
							onChange={(e) =>
								handleSettingChange("cacheTTL", parseInt((e.target as HTMLSelectElement).value))
							}>
							<VSCodeOption value="1">1 minute</VSCodeOption>
							<VSCodeOption value="5">5 minutes</VSCodeOption>
							<VSCodeOption value="10">10 minutes</VSCodeOption>
							<VSCodeOption value="30">30 minutes</VSCodeOption>
						</VSCodeDropdown>
					</div>
				</div>
				<div className="cache-info">
					<div className="cache-stat">
						<span className="label">Cache Size:</span>
						<span className="value">
							{cacheStats.size} / {cacheStats.maxSize}
						</span>
					</div>
					<VSCodeButton appearance="secondary" onClick={handleClearCache}>
						<Trash2 size={16} />
						Clear Cache
					</VSCodeButton>
				</div>
			</div>

			<VSCodeDivider />

			<div className="settings-info">
				<Info size={16} />
				<p>
					Context-aware completions analyze your entire codebase to provide more relevant suggestions. Higher
					context limits may improve accuracy but use more resources.
				</p>
			</div>

			<div className="settings-footer">
				<VSCodeButton appearance="secondary" onClick={onClose}>
					Cancel
				</VSCodeButton>
				<VSCodeButton appearance="primary" onClick={handleSave} disabled={loading}>
					{loading ? "Saving..." : "Save"}
				</VSCodeButton>
			</div>
		</div>
	)
}

export default CompletionSettings
