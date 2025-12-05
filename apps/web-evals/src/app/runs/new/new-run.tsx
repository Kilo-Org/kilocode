"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { X, Rocket, Check, ChevronsUpDown, SlidersHorizontal } from "lucide-react"

import {
	globalSettingsSchema,
	providerSettingsSchema,
	EVALS_SETTINGS,
	getModelId,
	type ProviderSettings,
	type GlobalSettings,
} from "@roo-code/types"

import { createRun } from "@/actions/runs"
import { getExercises } from "@/actions/exercises"

import {
	type CreateRun,
	createRunSchema,
	CONCURRENCY_MIN,
	CONCURRENCY_MAX,
	CONCURRENCY_DEFAULT,
	TIMEOUT_MIN,
	TIMEOUT_MAX,
	TIMEOUT_DEFAULT,
} from "@/lib/schemas"
import { cn } from "@/lib/utils"

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
	FormDescription,
} from "@/components/ui"

import { SettingsDiff } from "./settings-diff"

type ImportedSettings = {
	apiConfigs: Record<string, ProviderSettings>
	globalSettings: GlobalSettings
	currentApiConfigName: string
}

export function NewRun() {
	const router = useRouter()

	const [provider, setModelSource] = useState<"roo" | "openrouter" | "other">("roo")
	const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
	const [useNativeToolProtocol, setUseNativeToolProtocol] = useState(true)

	// State for imported settings with config selection
	const [importedSettings, setImportedSettings] = useState<ImportedSettings | null>(null)
	const [selectedConfigName, setSelectedConfigName] = useState<string>("")
	const [configPopoverOpen, setConfigPopoverOpen] = useState(false)

	const openRouter = useOpenRouterModels()
	const rooCodeCloud = useRooCodeCloudModels()
	const models = provider === "openrouter" ? openRouter.data : rooCodeCloud.data
	const searchValue = provider === "openrouter" ? openRouter.searchValue : rooCodeCloud.searchValue
	const setSearchValue = provider === "openrouter" ? openRouter.setSearchValue : rooCodeCloud.setSearchValue
	const onFilter = provider === "openrouter" ? openRouter.onFilter : rooCodeCloud.onFilter

	const exercises = useQuery({ queryKey: ["getExercises"], queryFn: () => getExercises() })

	// State for selected exercises (needed for language toggle buttons)
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
			jobToken: "",
		},
	})

	const {
		setValue,
		clearErrors,
		watch,
		formState: { isSubmitting },
	} = form

	const [model, suite, settings] = watch(["model", "suite", "settings", "concurrency"])

	// Load concurrency and timeout from localStorage on mount
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
	}, [setValue])

	// Extract unique languages from exercises
	const languages = useMemo(() => {
		if (!exercises.data) return []
		const langs = new Set<string>()
		for (const path of exercises.data) {
			const lang = path.split("/")[0]
			if (lang) langs.add(lang)
		}
		return Array.from(langs).sort()
	}, [exercises.data])

	// Get exercises for a specific language
	const getExercisesForLanguage = useCallback(
		(lang: string) => {
			if (!exercises.data) return []
			return exercises.data.filter((path) => path.startsWith(`${lang}/`))
		},
		[exercises.data],
	)

	// Toggle all exercises for a language
	const toggleLanguage = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			const allSelected = langExercises.every((ex) => selectedExercises.includes(ex))

			let newSelected: string[]
			if (allSelected) {
				// Remove all exercises for this language
				newSelected = selectedExercises.filter((ex) => !ex.startsWith(`${lang}/`))
			} else {
				// Add all exercises for this language (avoiding duplicates)
				const existing = new Set(selectedExercises)
				for (const ex of langExercises) {
					existing.add(ex)
				}
				newSelected = Array.from(existing)
			}

			setSelectedExercises(newSelected)
			setValue("exercises", newSelected)
		},
		[getExercisesForLanguage, selectedExercises, setValue],
	)

	// Check if all exercises for a language are selected
	const isLanguageSelected = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			return langExercises.length > 0 && langExercises.every((ex) => selectedExercises.includes(ex))
		},
		[getExercisesForLanguage, selectedExercises],
	)

	// Check if some (but not all) exercises for a language are selected
	const isLanguagePartiallySelected = useCallback(
		(lang: string) => {
			const langExercises = getExercisesForLanguage(lang)
			const selectedCount = langExercises.filter((ex) => selectedExercises.includes(ex)).length
			return selectedCount > 0 && selectedCount < langExercises.length
		},
		[getExercisesForLanguage, selectedExercises],
	)

	const onSubmit = useCallback(
		async (values: CreateRun) => {
			try {
				if (provider === "openrouter") {
					values.settings = {
						...(values.settings || {}),
						apiProvider: "openrouter",
						openRouterModelId: model,
						toolStyle: useNativeToolProtocol ? "json" : "xml", // kilocode_change
					}
				} else if (provider === "roo") {
					values.settings = {
						...(values.settings || {}),
						apiProvider: "roo",
						apiModelId: model,
						toolStyle: useNativeToolProtocol ? "json" : "xml", // kilocode_change
					}
				}

				const { id } = await createRun(values)
				router.push(`/runs/${id}`)
			} catch (e) {
				toast.error(e instanceof Error ? e.message : "An unknown error occurred.")
			}
		},
		[provider, model, router, useNativeToolProtocol],
	)

	const onSelectModel = useCallback(
		(model: string) => {
			setValue("model", model)
			setModelPopoverOpen(false)
		},
		[setValue, setModelPopoverOpen],
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

				// Store all imported configs for user selection
				setImportedSettings({
					apiConfigs: providerProfiles.apiConfigs,
					globalSettings,
					currentApiConfigName: providerProfiles.currentApiConfigName,
				})

				// Default to the current config
				const defaultConfigName = providerProfiles.currentApiConfigName
				setSelectedConfigName(defaultConfigName)

				// Apply the default config
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

	const onSelectConfig = useCallback(
		(configName: string) => {
			if (!importedSettings) {
				return
			}

			setSelectedConfigName(configName)
			setConfigPopoverOpen(false)

			const providerSettings = importedSettings.apiConfigs[configName] ?? {}
			setValue("model", getModelId(providerSettings) ?? "")
			setValue("settings", { ...EVALS_SETTINGS, ...providerSettings, ...importedSettings.globalSettings })
		},
		[importedSettings, setValue],
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
										<TabsTrigger value="roo">Roo Code Cloud</TabsTrigger>
										<TabsTrigger value="openrouter">OpenRouter</TabsTrigger>
										<TabsTrigger value="other">Other</TabsTrigger>
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

										{importedSettings && Object.keys(importedSettings.apiConfigs).length > 1 && (
											<div className="space-y-1">
												<Label>API Config</Label>
												<Popover open={configPopoverOpen} onOpenChange={setConfigPopoverOpen}>
													<PopoverTrigger asChild>
														<Button
															variant="input"
															role="combobox"
															aria-expanded={configPopoverOpen}
															className="flex items-center justify-between w-full">
															<div>{selectedConfigName || "Select config"}</div>
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
																	{Object.keys(importedSettings.apiConfigs).map(
																		(configName) => (
																			<CommandItem
																				key={configName}
																				value={configName}
																				onSelect={onSelectConfig}>
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
																							selectedConfigName
																							? "opacity-100"
																							: "opacity-0",
																					)}
																				/>
																			</CommandItem>
																		),
																	)}
																</CommandGroup>
															</CommandList>
														</Command>
													</PopoverContent>
												</Popover>
											</div>
										)}

										{settings && (
											<SettingsDiff defaultSettings={EVALS_SETTINGS} customSettings={settings} />
										)}
									</div>
								) : (
									<>
										<Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
											<PopoverTrigger asChild>
												<Button
													variant="input"
													role="combobox"
													aria-expanded={modelPopoverOpen}
													className="flex items-center justify-between">
													<div>
														{models?.find(({ id }) => id === model)?.name || `Select`}
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
																	onSelect={onSelectModel}>
																	{name}
																	<Check
																		className={cn(
																			"ml-auto text-accent group-data-[selected=true]:text-accent-foreground size-4",
																			id === model ? "opacity-100" : "opacity-0",
																		)}
																	/>
																</CommandItem>
															))}
														</CommandGroup>
													</CommandList>
												</Command>
											</PopoverContent>
										</Popover>

										<div className="flex items-center gap-1.5">
											<Checkbox
												id="native"
												checked={useNativeToolProtocol}
												onCheckedChange={(checked) =>
													setUseNativeToolProtocol(checked === true)
												}
											/>
											<Label htmlFor="native">Use Native Tool Calls</Label>
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
									<FormLabel>Roo Code Cloud Token</FormLabel>
									<FormControl>
										<Input type="password" {...field} />
									</FormControl>
									<FormMessage />
									<FormDescription>
										If you have access to the Roo Code Cloud repository then you can generate a
										token with:
										<br />
										<code className="text-xs">
											pnpm --filter @roo-code-cloud/auth production:create-job-token [org]
											[timeout]
										</code>
									</FormDescription>
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
										defaultValue="full"
										onValueChange={(value) => {
											setValue("suite", value as "full" | "partial")
											if (value === "full") {
												setSelectedExercises([])
												setValue("exercises", [])
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
										<div>{field.value}</div>
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
										<div>{field.value}</div>
									</div>
								</FormControl>
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
