import { useCallback, useRef } from "react"
import { MAX_IMAGES_PER_MESSAGE } from "../state/atoms/sessions"

const ACCEPTED_IMAGE_TYPES = ["png", "jpeg", "webp", "gif"]
const ACCEPTED_MIME_TYPES = ACCEPTED_IMAGE_TYPES.map((t) => `image/${t}`).join(",")

interface UseImagePasteOptions {
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	disabled?: boolean
}

/**
 * Hook for handling image selection from files and paste from clipboard.
 * Returns handlers for file input, paste events, and image management.
 */
export function useImagePaste({ selectedImages, setSelectedImages, disabled = false }: UseImagePasteOptions) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const canAddMore = selectedImages.length < MAX_IMAGES_PER_MESSAGE && !disabled

	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			if (!canAddMore) return

			const items = e.clipboardData.items

			const imageItems = Array.from(items).filter((item) => {
				const [type, subtype] = item.type.split("/")
				return type === "image" && ACCEPTED_IMAGE_TYPES.includes(subtype)
			})

			if (imageItems.length === 0) return

			e.preventDefault()

			const imagePromises = imageItems.map((item) => {
				return new Promise<string | null>((resolve) => {
					const blob = item.getAsFile()
					if (!blob) {
						resolve(null)
						return
					}

					const reader = new FileReader()
					reader.onloadend = () => {
						if (reader.error) {
							console.error("Error reading image file:", reader.error)
							resolve(null)
						} else {
							const result = reader.result
							resolve(typeof result === "string" ? result : null)
						}
					}
					reader.readAsDataURL(blob)
				})
			})

			const imageDataArray = await Promise.all(imagePromises)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

			if (dataUrls.length > 0) {
				setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
			}
		},
		[canAddMore, setSelectedImages],
	)

	/**
	 * Handle file selection from the file input.
	 * Reads selected files and converts them to data URLs.
	 */
	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (!canAddMore) return

			const files = e.target.files
			if (!files || files.length === 0) return

			const remainingSlots = MAX_IMAGES_PER_MESSAGE - selectedImages.length
			const filesToProcess = Array.from(files).slice(0, remainingSlots)

			filesToProcess.forEach((file) => {
				const reader = new FileReader()
				reader.onloadend = () => {
					if (reader.error) {
						console.error("Error reading image file:", reader.error)
						return
					}
					const result = reader.result
					if (typeof result === "string") {
						setSelectedImages((prev) => [...prev, result].slice(0, MAX_IMAGES_PER_MESSAGE))
					}
				}
				reader.readAsDataURL(file)
			})

			// Reset input value to allow selecting the same file again
			e.target.value = ""
		},
		[canAddMore, selectedImages.length, setSelectedImages],
	)

	/**
	 * Trigger the hidden file input to open file browser.
	 */
	const openFileBrowser = useCallback(() => {
		if (!canAddMore) return
		fileInputRef.current?.click()
	}, [canAddMore])

	const removeImage = useCallback(
		(index: number) => {
			setSelectedImages((prevImages) => prevImages.filter((_, i) => i !== index))
		},
		[setSelectedImages],
	)

	return {
		handlePaste,
		handleFileSelect,
		openFileBrowser,
		removeImage,
		canAddMore,
		fileInputRef,
		acceptedMimeTypes: ACCEPTED_MIME_TYPES,
	}
}
