import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import {
	GenerateImageParams,
	IMAGE_GENERATION_MODEL_IDS,
	IMAGE_GENERATION_MODELS,
	getImageGenerationProvider,
} from "@roo-code/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { OpenRouterHandler } from "../../api/providers/openrouter"
import { KilocodeOpenrouterHandler } from "../../api/providers/kilocode-openrouter"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

import { RooHandler } from "../../api/providers/roo"
import { t } from "../../i18n"

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	parseLegacy(params: Partial<Record<string, string>>): GenerateImageParams {
		return {
			prompt: params.prompt || "",
			path: params.path || "",
			image: params.image,
		}
	}

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { prompt, path: relPath, image: inputImagePath } = params
		const { handleError, pushToolResult, askApproval, removeClosingTag, toolProtocol } = callbacks

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isImageGenerationEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.IMAGE_GENERATION,
		)

		if (!isImageGenerationEnabled) {
			pushToolResult(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
			return
		}

		if (!prompt) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "prompt"))
			return
		}

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "path"))
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol))
			return
		}

		let inputImageData: string | undefined
		if (inputImagePath) {
			const inputImageFullPath = path.resolve(task.cwd, inputImagePath)

			const inputImageExists = await fileExistsAtPath(inputImageFullPath)
			if (!inputImageExists) {
				await task.say("error", `Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(`Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`),
				)
				return
			}

			const inputImageAccessAllowed = task.rooIgnoreController?.validateAccess(inputImagePath)
			if (!inputImageAccessAllowed) {
				await task.say("rooignore_error", inputImagePath)
				pushToolResult(formatResponse.rooIgnoreError(inputImagePath, toolProtocol))
				return
			}

			try {
				const imageBuffer = await fs.readFile(inputImageFullPath)
				const imageExtension = path.extname(inputImageFullPath).toLowerCase().replace(".", "")

				const supportedFormats = ["png", "jpg", "jpeg", "gif", "webp"]
				if (!supportedFormats.includes(imageExtension)) {
					await task.say(
						"error",
						`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
					)
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
						),
					)
					return
				}

				const mimeType = imageExtension === "jpg" ? "jpeg" : imageExtension
				inputImageData = `data:image/${mimeType};base64,${imageBuffer.toString("base64")}`
			} catch (error) {
				await task.say(
					"error",
					`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
				)
				return
			}
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		// Use shared utility for backwards compatibility logic
		const imageProvider = getImageGenerationProvider(
			state?.imageGenerationProvider,
			!!state?.openRouterImageGenerationSelectedModel,
		)

		// Get the selected model
		let selectedModel = state?.openRouterImageGenerationSelectedModel
		let modelInfo = undefined

		// Find the model info matching both value AND provider
		// (since the same model value can exist for multiple providers)
		if (selectedModel) {
			modelInfo = IMAGE_GENERATION_MODELS.find((m) => m.value === selectedModel && m.provider === imageProvider)
			if (!modelInfo) {
				// Model doesn't exist for this provider, use first model for selected provider
				const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === imageProvider)
				modelInfo = providerModels[0]
				selectedModel = modelInfo?.value || IMAGE_GENERATION_MODEL_IDS[0]
			}
		} else {
			// No model selected, use first model for selected provider
			const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === imageProvider)
			modelInfo = providerModels[0]
			selectedModel = modelInfo?.value || IMAGE_GENERATION_MODEL_IDS[0]
		}

		// Use the provider selection
		const modelProvider = imageProvider
		const apiMethod = modelInfo?.apiMethod

		// Validate API key for OpenRouter
		const openRouterApiKey = state?.openRouterImageApiKey
		const kiloCodeApiKey = state?.kiloCodeImageApiKey // kilocode_change

		// kilocode_change start
		if (imageProvider === "openrouter" && !openRouterApiKey && !kiloCodeApiKey) {
			// kilocode_change end
			const errorMessage = t("tools:generateImage.openRouterApiKeyRequired")
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const fullPath = path.resolve(task.cwd, removeClosingTag("path", relPath))
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		const sharedMessageProps = {
			tool: "generateImage" as const,
			path: getReadablePath(task.cwd, removeClosingTag("path", relPath)),
			content: prompt,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		try {
			task.consecutiveMistakeCount = 0

			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: prompt,
				...(inputImagePath && { inputImage: getReadablePath(task.cwd, inputImagePath) }),
			})

			const didApprove = await askApproval("tool", approvalMessage, undefined, isWriteProtected)

			if (!didApprove) {
				return
			}

			let result
			// kilocode_change start: Updated from "roo" to "kilocode" provider
			// Use Kilo Code Cloud provider (supports both chat completions and images API via OpenRouter)
			// Use OpenRouter provider (only supports chat completions API)
			const handler =
				modelProvider === "kilocode"
					? new KilocodeOpenrouterHandler({
							kilocodeToken: kiloCodeApiKey,
							kilocodeOrganizationId:
								task.apiConfiguration.apiProvider === "kilocode" &&
								task.apiConfiguration.kilocodeToken === kiloCodeApiKey
									? task.apiConfiguration.kilocodeOrganizationId
									: undefined,
						})
					: new OpenRouterHandler({})
			result = await handler.generateImage(
				prompt,
				selectedModel,
				openRouterApiKey ||
					kiloCodeApiKey ||
					(() => {
						throw new Error("Unreachable because of earlier check.")
					})(),

				inputImageData,
				task.taskId,
			)

			// kilocode_change end

			if (!result.success) {
				await task.say("error", result.error || "Failed to generate image")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(result.error || "Failed to generate image"))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const base64Match = result.imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			const imageBuffer = Buffer.from(base64Data, "base64")

			const absolutePath = path.resolve(task.cwd, finalPath)
			const directory = path.dirname(absolutePath)
			await fs.mkdir(directory, { recursive: true })

			await fs.writeFile(absolutePath, imageBuffer)

			if (finalPath) {
				await task.fileContextTracker.trackFileContext(finalPath, "roo_edited")
			}

			task.didEditFile = true

			task.recordToolUsage("generate_image")

			const fullImagePath = path.join(task.cwd, finalPath)

			let imageUri = provider?.convertToWebviewUri?.(fullImagePath) ?? vscode.Uri.file(fullImagePath).toString()

			const cacheBuster = Date.now()
			imageUri = imageUri.includes("?") ? `${imageUri}&t=${cacheBuster}` : `${imageUri}?t=${cacheBuster}`

			await task.say("image", JSON.stringify({ imageUri, imagePath: fullImagePath }))
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			await handleError("generating image", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"generate_image">): Promise<void> {
		return
	}
}

export const generateImageTool = new GenerateImageTool()
