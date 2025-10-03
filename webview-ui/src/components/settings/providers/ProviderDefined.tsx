import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import {
	VSCodeTextField,
	VSCodeButton,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeRadioGroup,
	VSCodeRadio,
} from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"
import { ModelRecord } from "@roo/api"
import { ExtensionMessage } from "@roo/ExtensionMessage"

import { vscode } from "@src/utils/vscode"

import { inputEventTransform } from "../transforms"

type ProviderDefinedProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

type SourceType = "manifest" | "embedded"

export const ProviderDefined = ({ apiConfiguration, setApiConfigurationField }: ProviderDefinedProps) => {
	const [models, setModels] = useState<ModelRecord>({})
	const [providerName, setProviderName] = useState<string | undefined>()
	const [isFetching, setIsFetching] = useState(false)
	const [fetchError, setFetchError] = useState<string | undefined>()
	const [hasFetched, setHasFetched] = useState(false)

	const selectedSource: SourceType =
		(apiConfiguration.providerDefinedSource as SourceType | undefined) ||
		(apiConfiguration.providerDefinedEmbeddedJson ? "embedded" : "manifest")

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	useEffect(() => {
		if (!apiConfiguration.providerDefinedSource) {
			setApiConfigurationField(
				"providerDefinedSource",
				(apiConfiguration.providerDefinedEmbeddedJson
					? "embedded"
					: "manifest") as ProviderSettings["providerDefinedSource"],
			)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const handleSourceChange = useCallback(
		(event: Event) => {
			const value = ((event.target as HTMLInputElement | null)?.value as SourceType | undefined) ?? "manifest"
			setApiConfigurationField("providerDefinedSource", value as ProviderSettings["providerDefinedSource"])
			setFetchError(undefined)
			setHasFetched(false)
			setModels({})
			setProviderName(undefined)
		},
		[setApiConfigurationField],
	)

	const handleFetchModels = useCallback(() => {
		const manifestUrl = apiConfiguration?.providerDefinedManifestUrl?.trim() || ""
		const embeddedJson = apiConfiguration?.providerDefinedEmbeddedJson?.trim() || ""

		if (selectedSource === "manifest" && !manifestUrl) {
			setFetchError("Manifest URL is required before fetching models.")
			return
		}

		if (selectedSource === "embedded" && !embeddedJson) {
			setFetchError("Embedded JSON must be provided before parsing models.")
			return
		}

		setIsFetching(true)
		setFetchError(undefined)
		setHasFetched(false)
		setModels({})
		setProviderName(undefined)

		vscode.postMessage({
			type: "requestProviderDefinedModels",
			values: {
				providerDefinedManifestUrl: manifestUrl,
				providerDefinedApiKey: apiConfiguration?.providerDefinedApiKey,
				providerDefinedHeaders: apiConfiguration?.providerDefinedHeaders,
				providerDefinedEmbeddedJson: embeddedJson || undefined,
				embeddedData: embeddedJson || undefined,
				forceRefresh: true,
			},
		})
	}, [
		apiConfiguration?.providerDefinedManifestUrl,
		apiConfiguration?.providerDefinedApiKey,
		apiConfiguration?.providerDefinedHeaders,
		apiConfiguration?.providerDefinedEmbeddedJson,
		selectedSource,
	])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "providerDefinedModels":
				setIsFetching(false)
				setFetchError(undefined)
				setHasFetched(true)
				setModels(message.providerDefinedModels ?? {})
				setProviderName(message.providerDefinedManifest?.name)
				break
			case "singleRouterModelFetchResponse": {
				const providerKey = message.values?.provider
				if (providerKey === "provider-defined") {
					setIsFetching(false)
					setFetchError(message.error || "Failed to process provider data.")
					setHasFetched(false)
					setModels({})
					setProviderName(undefined)
				}
				break
			}
		}
	}, [])

	useEvent("message", onMessage)

	useEffect(() => {
		if (!hasFetched) {
			return
		}

		const availableModels = Object.keys(models)
		if (availableModels.length === 0) {
			return
		}

		const selectedModel = apiConfiguration?.providerDefinedModelId
		if (!selectedModel || !models[selectedModel]) {
			const firstModel = availableModels[0]
			setApiConfigurationField("providerDefinedModelId", firstModel)
		}
	}, [hasFetched, models, apiConfiguration?.providerDefinedModelId, setApiConfigurationField])

	const sortedModelEntries = useMemo(() => Object.keys(models).sort((a, b) => a.localeCompare(b)), [models])

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<label className="block font-medium">Model Source</label>
				<VSCodeRadioGroup value={selectedSource} onChange={(event) => handleSourceChange(event as Event)}>
					<VSCodeRadio value="manifest">Manifest URL</VSCodeRadio>
					<VSCodeRadio value="embedded">Embedded JSON</VSCodeRadio>
				</VSCodeRadioGroup>
			</div>

			{selectedSource === "manifest" && (
				<div className="flex gap-2 items-end">
					<VSCodeTextField
						value={apiConfiguration?.providerDefinedManifestUrl || ""}
						onInput={handleInputChange("providerDefinedManifestUrl")}
						placeholder="https://api.example.com/v1/models?provider=true"
						className="flex-1">
						<label className="block font-medium mb-1">Manifest URL</label>
					</VSCodeTextField>
					<VSCodeButton appearance="primary" onClick={handleFetchModels} disabled={isFetching}>
						{isFetching ? "Fetching..." : "Fetch"}
					</VSCodeButton>
				</div>
			)}

			{selectedSource === "embedded" && (
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-1">
						<label className="block font-medium">Embedded Provider JSON</label>
						<textarea
							className="w-full min-h-[160px] rounded bg-transparent border border-[var(--vscode-input-border)] p-2 text-sm"
							placeholder="Paste the embedded provider JSON array here"
							value={apiConfiguration?.providerDefinedEmbeddedJson || ""}
							onChange={(event) =>
								setApiConfigurationField(
									"providerDefinedEmbeddedJson",
									(event.target as HTMLTextAreaElement).value,
								)
							}
						/>
						<div className="text-xs text-vscode-descriptionForeground">
							If supplied, this embedded JSON is parsed instead of fetching a manifest URL. Provide an
							array with [providerResponse, extendedModelsResponse].
						</div>
					</div>
					<div>
						<VSCodeButton appearance="primary" onClick={handleFetchModels} disabled={isFetching}>
							{isFetching ? "Parsing..." : "Parse"}
						</VSCodeButton>
					</div>
				</div>
			)}

			{fetchError && <div className="text-sm text-vscode-errorForeground">{fetchError}</div>}

			<VSCodeTextField
				value={apiConfiguration?.providerDefinedApiKey || ""}
				type="password"
				onInput={handleInputChange("providerDefinedApiKey")}
				placeholder="sk-..."
				className="w-full">
				<label className="block font-medium mb-1">API Key</label>
			</VSCodeTextField>

			{providerName && (
				<div className="text-sm text-vscode-descriptionForeground">Fetched provider: {providerName}</div>
			)}

			{hasFetched && (
				<div className="flex flex-col gap-2">
					<label className="block font-medium">Model</label>
					{sortedModelEntries.length > 0 ? (
						<VSCodeDropdown
							className="w-full"
							value={apiConfiguration?.providerDefinedModelId || ""}
							onChange={handleInputChange("providerDefinedModelId")}>
							{sortedModelEntries.map((modelId) => (
								<VSCodeOption key={modelId} value={modelId}>
									{modelId}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					) : (
						<div className="text-sm text-vscode-descriptionForeground">
							No models were returned for this provider.
						</div>
					)}
				</div>
			)}
		</div>
	)
}
