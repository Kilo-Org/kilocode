"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
	X,
	Rocket,
	Check,
	ChevronsUpDown,
	SlidersHorizontal,
	Info,
	Plus,
	Minus,
	Terminal,
	MonitorPlay,
} from "lucide-react"

import {
	type ProviderSettings,
	type GlobalSettings,
	globalSettingsSchema,
	providerSettingsSchema,
	getModelId,
	EVALS_SETTINGS,
} from "@roo-code/types"

import { createRun } from "@/actions/runs"
import { getExercises } from "@/actions/exercises"

import {
	type CreateRun,
	type ExecutionMethod,
	createRunSchema,
	CONCURRENCY_MIN,
	CONCURRENCY_MAX,
	CONCURRENCY_DEFAULT,
	TIMEOUT_MIN,
	TIMEOUT_MAX,
	TIMEOUT_DEFAULT,
	ITERATIONS_MIN,
	ITERATIONS_MAX,
	ITERATIONS_DEFAULT,
} from "@/lib/schemas"
import { cn } from "@/lib/utils"

import { loadRooLastModelSelection, saveRooLastModelSelection } from "@/lib/roo-last-model-selection"
import { normalizeCreateRunForSubmit } from "@/lib/normalize-create-run"

import { useOpenRouterModels } from "@/hooks/use-open-router-models"
import { useRooCodeCloudModels } from "@/hooks/use-roo-code-cloud-models"

import {
	Button,
	Checkbox,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
	Input,
	Textarea,
	Tabs,
	TabsList,
	TabsTrigger,
	MultiSelect,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Slider,
	Label,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui"

import { SettingsDiff } from "./settings-diff"

type ImportedSettings = {
	apiConfigs: Record<string, ProviderSettings>
	globalSettings: GlobalSettings
	currentApiConfigName: string
}

type ModelSelection = {
	id: string
	model: string
	popoverOpen: boolean
}

type ConfigSelection = {
	id: string
	configName: string
	popoverOpen: boolean
}

export function NewRun() {
	const router = useRouter()
	const modelSelectionsByProviderRef = useRef<Record<string, ModelSelection[]>>({})
	const modelValueByProviderRef = useRef<Record<string, string>>({})

	const [provider, setModelSource] = useState<"roo" | "openrouter" | "other">("other")
	const [executionMethod, setExecutionMethod] = useState<ExecutionMethod>("vscode")
	const [useNativeToolProtocol, setUseNativeToolProtocol] = useState(true)
	const [commandExecutionTimeout, setCommandExecutionTimeout] = useState(20)
	const [terminalShellIntegrationTimeout, setTerminalShellIntegrationTimeout] = useState(30) // seconds

	const [modelSelections, setModelSelections] = useState<ModelSelection[]>([
		{ id: crypto.randomUUID(), model: "", popoverOpen: false },
	])

	const [importedSettings, setImportedSettings] = useState<ImportedSettings | null>(null)
	const [configSelections, setConfigSelections] = useState<ConfigSelection[]>([
		{ id: crypto.randomUUID(), configName: "", popoverOpen: false },
	])

	const openRouter = useOpenRouterModels()
	const rooCodeCloud = useRooCodeCloudModels()
	const models = provider === "openrouter" ? openRouter.data : rooCodeCloud.data
	const searchValue = provider === "openrouter" ? openRouter.searchValue : rooCodeCloud.searchValue
	const setSearchValue = provider === "openrouter" ? openRouter.setSearchValue : rooCodeCloud.setSearchValue
	const onFilter = provider === "openrouter" ? openRouter.onFilter : rooCodeCloud.onFilter

	const exercises = useQuery({ queryKey: ["getExercises"], queryFn: () => getExercises() })

	const [selectedExercises, setSelectedExercises] = useState<string[]>([])

	const form = useForm<CreateRun>({
		resolver: zodResolver(createRunSchema),
		defaultValues: {
			model: "",
			description: "",
			suite: "full",
			exercises: [],
			settings: undefined,
			concurrency: CONCURRENCY_DEFAULT,
			timeout: TIMEOUT_DEFAULT,
			iterations: ITERATIONS_DEFAULT,
			jobToken: "",
			executionMethod: "vscode",
		},
	})

	const {
		register,
		setValue,
		clearErrors,
		watch,
		getValues,
		formState: { isSubmitting },
	} = form

	const [suite, settings] = watch(["suite", "settings", "concurrency"])

	const selectedModelIds = useMemo(
		() => modelSelections.map((s) => s.model).filter((m) => m.length > 0),
		[modelSelections],
	)

	const applyModelIds = useCallback(
		(modelIds: string[]) => {
			const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter((m) => m.length > 0)))

			if (unique.length === 0) {
				setModelSelections([{ id: crypto.randomUUID(), model: "", popoverOpen: false }])
				setValue("model", "")
				return
			}

			setModelSelections(unique.map((model) => ({ id: crypto.randomUUID(), model, popoverOpen: false })))
			setValue("model", unique[0] ?? "")
		},
		[setValue],
	)

	// Ensure the `exercises` field is registered so RHF always includes it in submit values.
	useEffect(() => {
		register("exercises")
	}, [register])

	// Load settings from localStorage on mount
	useEffect(() => {
		const savedConcurrency = localStorage.getItem("evals-concurrency")

		if (savedConcurrency) {
			const parsed = parseInt(savedConcurrency, 10)

			if (!isNaN(parsed) && parsed >= CONCURRENCY_MIN && parsed <= CONCURRENCY_MAX) {
				setValue("concurrency", parsed)
			}
		}

		const savedTimeout = localStorage.getItem("evals-timeout")

		if (savedTimeout) {
			const parsed = parseInt(savedTimeout, 10)

			if (!isNaN(parsed) && parsed >= TIMEOUT_MIN && parsed <= TIMEOUT_MAX) {
				setValue("timeout", parsed)
			}
		}

		const savedCommandTimeout = localStorage.getItem("evals-command-execution-timeout")

		if (savedCommandTimeout) {
			const parsed = parseInt(savedCommandTimeout, 10)

			if (!isNaN(parsed) && parsed >= 20 && parsed <= 60) {
				setCommandExecutionTimeout(parsed)
			}
		}

		const savedShellTimeout = localStorage.getItem("evals-shell-integration-timeout")

		if (savedShellTimeout) {
			const parsed = parseInt(savedShellTimeout, 10)

			if (!isNaN(parsed) && parsed >= 30 && parsed <= 60) {
				setTerminalShellIntegrationTimeout(parsed)
			}
		}

		const savedSuite = localStorage.getItem("evals-suite")

		if (savedSuite === "partial") {
			setValue("suite", "partial")
			const savedExercises = localStorage.getItem("evals-exercises")
			if (savedExercises) {
				try {
					const parsed = JSON.parse(savedExercises) as string[]
					if (Array.isArray(parsed)) {
						setSelectedExercises(parsed)
						setValue("exercises", parsed)
					}
				} catch {
					// Invalid JSON, ignore.
				}
			}
		}
	}, [setValue])

	// Track previous provider to detect switches
	const [prevProvider, setPrevProvider] = useState(provider)

	// Preserve selections per provider; avoids cross-contamination while keeping UX stable.
	useEffect(() => {
		if (provider === prevProvider) return

		modelSelectionsByProviderRef.current[prevProvider] = modelSelections
		modelValueByProviderRef.current[prevProvider] = getValues("model")

		const nextModelSelections =
			modelSelectionsByProviderRef.current[provider] ??
			([{ id: crypto.randomUUID(), model: "", popoverOpen: false }] satisfies ModelSelection[])

		setModelSelections(nextModelSelections)

		const nextModelValue =
			modelValueByProviderRef.current[provider] ??
			nextModelSelections.find((s) => s.model.trim().length > 0)?.model ??
			(provider === "other" && importedSettings && configSelections[0]?.configName
				? (getModelId(importedSettings.apiConfigs[configSelections[0].configName] ?? {}) ?? "")
				: "")

		setValue("model", nextModelValue)
		setPrevProvider(provider)
	}, [provider, prevProvider, modelSelections, setValue, getValues, importedSettings, configSelections])

	// When switching to Roo provider, restore last-used selection if current selection is empty
	useEffect(() => {
		if (provider !== "roo") return
		if (selectedModelIds.length > 0) return

		const last = loadRooLastModelSelection()
		if (last.length > 0) {
			applyModelIds(last)
		}
	}, [applyModelIds, provider, selectedModelIds.length])

	// Persist last-used Roo provider model selection
	useEffect(() => {
		if (provider !== "roo") return
		saveRooLastModelSelection(selectedModelIds)
	}, [provider, selectedModelIds])

	// Extract unique languages from exercises
	const languages = useMemo(() => {
		if (!exercises.data) {
			return []
		}

		const langs = new Set<string>()

		for (const path of exercises.data) {
			const lang = path.split("/")[0]

			if (lang) {
				langs.add(lang)
			}
		}

		return Array.from(langs).sort()
	}, [exercises.data])

	const getExercisesForLanguage = useCallback(
		(lang: string) => {
			if (!exercises.data) {
				return []
			}

			return exercises.data.filter((path) => path.startsWith(`${lang}/`))
		},
		[exercises.data],
	)

	const toggleLanguage = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			const allSelected = langExercises.every((ex) => selectedExercises.includes(ex))

			let newSelected: string[]

			if (allSelected) {
				newSelected = selectedExercises.filter((ex) => !ex.startsWith(`${lang}/`))
			} else {
				const existing = new Set(selectedExercises)

				for (const ex of langExercises) {
					existing.add(ex)
				}

				newSelected = Array.from(existing)
			}

			setSelectedExercises(newSelected)
			setValue("exercises", newSelected)
			localStorage.setItem("evals-exercises", JSON.stringify(newSelected))
		},
		[getExercisesForLanguage, selectedExercises, setValue],
	)

	const isLanguageSelected = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			return langExercises.length > 0 && langExercises.every((ex) => selectedExercises.includes(ex))
		},
		[getExercisesForLanguage, selectedExercises],
	)

	const isLanguagePartiallySelected = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			const selectedCount = langExercises.filter((ex) => selectedExercises.includes(ex)).length
			return selectedCount > 0 && selectedCount < langExercises.length
		},
		[getExercisesForLanguage, selectedExercises],
	)

	const addModelSelection = useCallback(() => {
		setModelSelections((prev) => [...prev, { id: crypto.randomUUID(), model: "", popoverOpen: false }])
	}, [])

	const removeModelSelection = useCallback((id: string) => {
		setModelSelections((prev) => prev.filter((s) => s.id !== id))
	}, [])

	const updateModelSelection = useCallback(
		(id: string, model: string) => {
			setModelSelections((prev) => prev.map((s) => (s.id === id ? { ...s, model, popoverOpen: false } : s)))
			// Also set the form model field for validation (use first non-empty model).
			setValue("model", model)
		},
		[setValue],
	)

	const toggleModelPopover = useCallback((id: string, open: boolean) => {
		setModelSelections((prev) => prev.map((s) => (s.id === id ? { ...s, popoverOpen: open } : s)))
	}, [])

	const addConfigSelection = useCallback(() => {
		setConfigSelections((prev) => [...prev, { id: crypto.randomUUID(), configName: "", popoverOpen: false }])
	}, [])

	const removeConfigSelection = useCallback((id: string) => {
		setConfigSelections((prev) => prev.filter((s) => s.id !== id))
	}, [])

	const updateConfigSelection = useCallback(
		(id: string, configName: string) => {
			setConfigSelections((prev) => prev.map((s) => (s.id === id ? { ...s, configName, popoverOpen: false } : s)))

			// Also update the form settings for the first config (for validation).
			if (importedSettings) {
				const providerSettings = importedSettings.apiConfigs[configName] ?? {}
				setValue("model", getModelId(providerSettings) ?? "")
				setValue("settings", { ...EVALS_SETTINGS, ...providerSettings, ...importedSettings.globalSettings })
			}
		},
		[importedSettings, setValue],
	)

	const toggleConfigPopover = useCallback((id: string, open: boolean) => {
		setConfigSelections((prev) => prev.map((s) => (s.id === id ? { ...s, popoverOpen: open } : s)))
	}, [])

	const onSubmit = useCallback(
		async (values: CreateRun) => {
			try {
				const baseValues = normalizeCreateRunForSubmit(values, selectedExercises, suite)

				// Validate jobToken for Roo Code Cloud provider
				if (provider === "roo" && !baseValues.jobToken?.trim()) {
					toast.error("Roo Code Cloud Token is required")
					return
				}

				const selectionsToLaunch: { model: string; configName?: string }[] = []

				if (provider === "other") {
					for (const config of configSelections) {
						if (config.configName) {
							selectionsToLaunch.push({ model: "", configName: config.configName })
						}
					}
				} else {
					for (const selection of modelSelections) {
						if (selection.model) {
							selectionsToLaunch.push({ model: selection.model })
						}
					}
				}

				if (selectionsToLaunch.length === 0) {
					toast.error("Please select at least one model or config")
					return
				}

				const totalRuns = selectionsToLaunch.length
				toast.info(totalRuns > 1 ? `Launching ${totalRuns} runs (every 20 seconds)...` : "Launching run...")

				for (let i = 0; i < selectionsToLaunch.length; i++) {
					const selection = selectionsToLaunch[i]!

					// Wait 20 seconds between runs (except for the first one).
					if (i > 0) {
						await new Promise((resolve) => setTimeout(resolve, 20_000))
					}

					const runValues = { ...baseValues }

					if (provider === "openrouter") {
						runValues.model = selection.model
						runValues.settings = {
							...(runValues.settings || {}),
							apiProvider: "openrouter",
							openRouterModelId: selection.model,
							toolProtocol: useNativeToolProtocol ? "native" : "xml",
							commandExecutionTimeout,
							terminalShellIntegrationTimeout: terminalShellIntegrationTimeout * 1000,
						}
					} else if (provider === "roo") {
						runValues.model = selection.model
						runValues.settings = {
							...(runValues.settings || {}),
							apiProvider: "roo",
							apiModelId: selection.model,
							toolProtocol: useNativeToolProtocol ? "native" : "xml",
							commandExecutionTimeout,
							terminalShellIntegrationTimeout: terminalShellIntegrationTimeout * 1000,
						}
					} else if (provider === "other" && selection.configName && importedSettings) {
						const providerSettings = importedSettings.apiConfigs[selection.configName] ?? {}
						runValues.model = getModelId(providerSettings) ?? ""
						runValues.settings = {
							...EVALS_SETTINGS,
							...providerSettings,
							...importedSettings.globalSettings,
							toolProtocol: useNativeToolProtocol ? "native" : "xml",
							commandExecutionTimeout,
							terminalShellIntegrationTimeout: terminalShellIntegrationTimeout * 1000,
						}
					}

					try {
						await createRun(runValues)
						toast.success(`Run ${i + 1}/${totalRuns} launched`)
					} catch (e) {
						toast.error(`Run ${i + 1} failed: ${e instanceof Error ? e.message : "Unknown error"}`)
					}
				}

				router.push("/")
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[
			suite,
			selectedExercises,
			provider,
			modelSelections,
			configSelections,
			importedSettings,
			router,
			useNativeToolProtocol,
			commandExecutionTimeout,
			terminalShellIntegrationTimeout,
		],
	)

	const onImportSettings = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0]

			if (!file) {
				return
			}

			clearErrors("settings")

			try {
				const { providerProfiles, globalSettings } = z
					.object({
						providerProfiles: z.object({
							currentApiConfigName: z.string(),
							apiConfigs: z.record(z.string(), providerSettingsSchema),
						}),
						globalSettings: globalSettingsSchema,
					})
					.parse(JSON.parse(await file.text()))

				setImportedSettings({
					apiConfigs: providerProfiles.apiConfigs,
					globalSettings,
					currentApiConfigName: providerProfiles.currentApiConfigName,
				})

				const defaultConfigName = providerProfiles.currentApiConfigName
				setConfigSelections([{ id: crypto.randomUUID(), configName: defaultConfigName, popoverOpen: false }])

				const providerSettings = providerProfiles.apiConfigs[defaultConfigName] ?? {}
				setValue("model", getModelId(providerSettings) ?? "")
				setValue("settings", { ...EVALS_SETTINGS, ...providerSettings, ...globalSettings })

				event.target.value = ""
			} catch (e) {
				console.error(e)
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[clearErrors, setValue],
	)

	return (
		<>
			<FormProvider {...form}>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col justify-center divide-y divide-primary *:py-5">
					<FormField
						control={form.control}
						name="model"
						render={() => (
							<FormItem>
								<Tabs
									value={provider}
									onValueChange={(value) => setModelSource(value as "roo" | "openrouter" | "other")}>
									<TabsList className="mb-2">
										<TabsTrigger value="other">Import</TabsTrigger>
										<TabsTrigger value="roo">Roo Code Cloud</TabsTrigger>
										<TabsTrigger value="openrouter">OpenRouter</TabsTrigger>
									</TabsList>
								</Tabs>

								{provider === "other" ? (
									<div className="space-y-2 overflow-auto">
										<Button
											type="button"
											variant="secondary"
											onClick={() => document.getElementById("json-upload")?.click()}
											className="w-full">
											<SlidersHorizontal />
											Import Settings
										</Button>
										<input
											id="json-upload"
											type="file"
											accept="application/json"
											className="hidden"
											onChange={onImportSettings}
										/>

										{importedSettings && Object.keys(importedSettings.apiConfigs).length > 0 && (
											<div className="space-y-2">
												<Label>API Configs</Label>
												{configSelections.map((selection, index) => (
													<div key={selection.id} className="flex items-center gap-2">
														<Popover
															open={selection.popoverOpen}
															onOpenChange={(open) =>
																toggleConfigPopover(selection.id, open)
															}>
															<PopoverTrigger asChild>
																<Button
																	variant="input"
																	role="combobox"
																	aria-expanded={selection.popoverOpen}
																	className="flex items-center justify-between flex-1">
																	<div>{selection.configName || "Select config"}</div>
																	<ChevronsUpDown className="opacity-50" />
																</Button>
															</PopoverTrigger>
															<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
																<Command>
																	<CommandInput
																		placeholder="Search configs..."
																		className="h-9"
																	/>
																	<CommandList>
																		<CommandEmpty>No config found.</CommandEmpty>
																		<CommandGroup>
																			{Object.keys(
																				importedSettings.apiConfigs,
																			).map((configName) => (
																				<CommandItem
																					key={configName}
																					value={configName}
																					onSelect={() =>
																						updateConfigSelection(
																							selection.id,
																							configName,
																						)
																					}>
																					{configName}
																					{configName ===
																						importedSettings.currentApiConfigName && (
																						<span className="ml-2 text-xs text-muted-foreground">
																							(default)
																						</span>
																					)}
																					<Check
																						className={cn(
																							"ml-auto size-4",
																							configName ===
																								selection.configName
																								? "opacity-100"
																								: "opacity-0",
																						)}
																					/>
																				</CommandItem>
																			))}
																		</CommandGroup>
																	</CommandList>
																</Command>
															</PopoverContent>
														</Popover>
														{index === configSelections.length - 1 ? (
															<Button
																type="button"
																variant="outline"
																size="icon"
																onClick={addConfigSelection}
																className="shrink-0">
																<Plus className="size-4" />
															</Button>
														) : (
															<Button
																type="button"
																variant="outline"
																size="icon"
																onClick={() => removeConfigSelection(selection.id)}
																className="shrink-0">
																<Minus className="size-4" />
															</Button>
														)}
													</div>
												))}
											</div>
										)}

										<div className="mt-4 p-4 rounded-md bg-muted/30 border border-border space-y-3">
											<Label className="text-sm font-medium text-muted-foreground">
												Tool Protocol Options
											</Label>
											<div className="flex flex-col gap-2.5 pl-1">
												<label
													htmlFor="native-other"
													className="flex items-center gap-2 cursor-pointer">
													<Checkbox
														id="native-other"
														checked={useNativeToolProtocol}
														onCheckedChange={(checked: boolean) =>
															setUseNativeToolProtocol(checked)
														}
													/>
													<span className="text-sm">Use Native Tool Calls</span>
												</label>
											</div>
										</div>

										{settings && (
											<SettingsDiff defaultSettings={EVALS_SETTINGS} customSettings={settings} />
										)}
									</div>
								) : (
									<>
										<div className="space-y-2">
											{modelSelections.map((selection, index) => (
												<div key={selection.id} className="flex items-center gap-2">
													<Popover
														open={selection.popoverOpen}
														onOpenChange={(open) => toggleModelPopover(selection.id, open)}>
														<PopoverTrigger asChild>
															<Button
																variant="input"
																role="combobox"
																aria-expanded={selection.popoverOpen}
																className="flex items-center justify-between flex-1">
																<div>
																	{models?.find(({ id }) => id === selection.model)
																		?.name || `Select`}
																</div>
																<ChevronsUpDown className="opacity-50" />
															</Button>
														</PopoverTrigger>
														<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
															<Command filter={onFilter}>
																<CommandInput
																	placeholder="Search"
																	value={searchValue}
																	onValueChange={setSearchValue}
																	className="h-9"
																/>
																<CommandList>
																	<CommandEmpty>No model found.</CommandEmpty>
																	<CommandGroup>
																		{models?.map(({ id, name }) => (
																			<CommandItem
																				key={id}
																				value={id}
																				onSelect={() =>
																					updateModelSelection(
																						selection.id,
																						id,
																					)
																				}>
																				{name}
																				<Check
																					className={cn(
																						"ml-auto text-accent group-data-[selected=true]:text-accent-foreground size-4",
																						id === selection.model
																							? "opacity-100"
																							: "opacity-0",
																					)}
																				/>
																			</CommandItem>
																		))}
																	</CommandGroup>
																</CommandList>
															</Command>
														</PopoverContent>
													</Popover>
													{index === modelSelections.length - 1 ? (
														<Button
															type="button"
															variant="outline"
															size="icon"
															onClick={addModelSelection}
															className="shrink-0">
															<Plus className="size-4" />
														</Button>
													) : (
														<Button
															type="button"
															variant="outline"
															size="icon"
															onClick={() => removeModelSelection(selection.id)}
															className="shrink-0">
															<Minus className="size-4" />
														</Button>
													)}
												</div>
											))}
										</div>

										<div className="mt-4 p-4 rounded-md bg-muted/30 border border-border space-y-3">
											<Label className="text-sm font-medium text-muted-foreground">
												Tool Protocol Options
											</Label>
											<div className="flex flex-col gap-2.5 pl-1">
												<label
													htmlFor="native"
													className="flex items-center gap-2 cursor-pointer">
													<Checkbox
														id="native"
														checked={useNativeToolProtocol}
														onCheckedChange={(checked: boolean) =>
															setUseNativeToolProtocol(checked)
														}
													/>
													<span className="text-sm">Use Native Tool Calls</span>
												</label>
											</div>
										</div>
									</>
								)}

								<FormMessage />
							</FormItem>
						)}
					/>

					{provider === "roo" && (
						<FormField
							control={form.control}
							name="jobToken"
							render={({ field }) => (
								<FormItem>
									<div className="flex items-center gap-1">
										<FormLabel>Roo Code Cloud Token</FormLabel>
										<Tooltip>
											<TooltipTrigger asChild>
												<Info className="size-4 text-muted-foreground cursor-help" />
											</TooltipTrigger>
											<TooltipContent side="right" className="max-w-xs">
												<p>
													If you have access to the Roo Code Cloud repository and the
													decryption key for the .env.* files, generate a token with:
												</p>
												<code className="text-xs block mt-1">
													pnpm --filter @roo-code-cloud/auth production:create-auth-token
													[email] [org] [ttl]
												</code>
											</TooltipContent>
										</Tooltip>
									</div>
									<FormControl>
										<Input type="password" placeholder="Required" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					)}

					<FormField
						control={form.control}
						name="suite"
						render={() => (
							<FormItem>
								<FormLabel>Exercises</FormLabel>
								<div className="flex items-center gap-2 flex-wrap">
									<Tabs
										value={suite}
										onValueChange={(value) => {
											setValue("suite", value as "full" | "partial")
											localStorage.setItem("evals-suite", value)
											if (value === "full") {
												setSelectedExercises([])
												setValue("exercises", [])
												localStorage.removeItem("evals-exercises")
											}
										}}>
										<TabsList>
											<TabsTrigger value="full">All</TabsTrigger>
											<TabsTrigger value="partial">Some</TabsTrigger>
										</TabsList>
									</Tabs>
									{suite === "partial" && languages.length > 0 && (
										<div className="flex items-center gap-1 flex-wrap">
											{languages.map((lang) => (
												<Button
													key={lang}
													type="button"
													variant={
														isLanguageSelected(lang)
															? "default"
															: isLanguagePartiallySelected(lang)
																? "secondary"
																: "outline"
													}
													size="sm"
													onClick={() => toggleLanguage(lang)}
													className="text-xs capitalize">
													{lang}
												</Button>
											))}
										</div>
									)}
								</div>
								{suite === "partial" && (
									<MultiSelect
										options={exercises.data?.map((path) => ({ value: path, label: path })) || []}
										value={selectedExercises}
										onValueChange={(value) => {
											setSelectedExercises(value)
											setValue("exercises", value)
											localStorage.setItem("evals-exercises", JSON.stringify(value))
										}}
										placeholder="Select"
										variant="inverted"
										maxCount={4}
									/>
								)}
								<FormMessage />
							</FormItem>
						)}
					/>

					{/* Concurrency, Timeout, and Iterations in a 3-column row */}
					<div className="grid grid-cols-3 gap-4 py-5">
						<FormField
							control={form.control}
							name="concurrency"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Concurrency</FormLabel>
									<FormControl>
										<div className="flex flex-row items-center gap-2">
											<Slider
												value={[field.value]}
												min={CONCURRENCY_MIN}
												max={CONCURRENCY_MAX}
												step={1}
												onValueChange={(value) => {
													field.onChange(value[0])
													localStorage.setItem("evals-concurrency", String(value[0]))
												}}
											/>
											<div className="w-6 text-right">{field.value}</div>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="timeout"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Timeout (Minutes)</FormLabel>
									<FormControl>
										<div className="flex flex-row items-center gap-2">
											<Slider
												value={[field.value]}
												min={TIMEOUT_MIN}
												max={TIMEOUT_MAX}
												step={1}
												onValueChange={(value) => {
													field.onChange(value[0])
													localStorage.setItem("evals-timeout", String(value[0]))
												}}
											/>
											<div className="w-6 text-right">{field.value}</div>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="iterations"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Iterations</FormLabel>
									<FormControl>
										<div className="flex flex-row items-center gap-2">
											<Slider
												value={[field.value]}
												min={ITERATIONS_MIN}
												max={ITERATIONS_MAX}
												step={1}
												onValueChange={(value) => {
													field.onChange(value[0])
												}}
											/>
											<div className="w-6 text-right">{field.value}</div>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					{/* Terminal timeouts in a 2-column row */}
					<div className="grid grid-cols-2 gap-4 py-5">
						<FormItem>
							<div className="flex items-center gap-1">
								<Label>Command Timeout (Seconds)</Label>
								<Tooltip>
									<TooltipTrigger asChild>
										<Info className="size-4 text-muted-foreground cursor-help" />
									</TooltipTrigger>
									<TooltipContent side="right" className="max-w-xs">
										<p>
											Maximum time in seconds to wait for terminal command execution to complete
											before timing out. This applies to commands run via the execute_command
											tool.
										</p>
									</TooltipContent>
								</Tooltip>
							</div>
							<div className="flex flex-row items-center gap-2">
								<Slider
									value={[commandExecutionTimeout]}
									min={20}
									max={60}
									step={1}
									onValueChange={([value]) => {
										if (value !== undefined) {
											setCommandExecutionTimeout(value)
											localStorage.setItem("evals-command-execution-timeout", String(value))
										}
									}}
								/>
								<div className="w-8 text-right">{commandExecutionTimeout}</div>
							</div>
						</FormItem>

						<FormItem>
							<div className="flex items-center gap-1">
								<Label>Shell Integration Timeout (Seconds)</Label>
								<Tooltip>
									<TooltipTrigger asChild>
										<Info className="size-4 text-muted-foreground cursor-help" />
									</TooltipTrigger>
									<TooltipContent side="right" className="max-w-xs">
										<p>
											Maximum time in seconds to wait for shell integration to initialize when
											opening a new terminal.
										</p>
									</TooltipContent>
								</Tooltip>
							</div>
							<div className="flex flex-row items-center gap-2">
								<Slider
									value={[terminalShellIntegrationTimeout]}
									min={30}
									max={60}
									step={1}
									onValueChange={([value]) => {
										if (value !== undefined) {
											setTerminalShellIntegrationTimeout(value)
											localStorage.setItem("evals-shell-integration-timeout", String(value))
										}
									}}
								/>
								<div className="w-8 text-right">{terminalShellIntegrationTimeout}</div>
							</div>
						</FormItem>
					</div>

					{/* Execution Method */}
					<FormField
						control={form.control}
						name="executionMethod"
						render={() => (
							<FormItem>
								<FormLabel>Execution Method</FormLabel>
								<Tabs
									value={executionMethod}
									onValueChange={(value) => {
										const newExecutionMethod = value as ExecutionMethod
										setExecutionMethod(newExecutionMethod)
										setValue("executionMethod", newExecutionMethod)
									}}>
									<TabsList>
										<TabsTrigger value="vscode" className="flex items-center gap-2">
											<MonitorPlay className="size-4" />
											VSCode
										</TabsTrigger>
										<TabsTrigger value="cli" className="flex items-center gap-2">
											<Terminal className="size-4" />
											CLI
										</TabsTrigger>
									</TabsList>
								</Tabs>
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="description"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Description / Notes</FormLabel>
								<FormControl>
									<Textarea placeholder="Optional" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="flex justify-end">
						<Button size="lg" type="submit" disabled={isSubmitting}>
							<Rocket className="size-4" />
							Launch
						</Button>
					</div>
				</form>
			</FormProvider>

			<Button
				variant="default"
				className="absolute top-4 right-12 size-12 rounded-full"
				onClick={() => router.push("/")}>
				<X className="size-6" />
			</Button>
		</>
	)
}
