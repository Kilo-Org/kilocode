import QRCode from "qrcode"

/**
 * Generate a QR code as a data URL
 * @param text The text to encode in the QR code
 * @param options QR code generation options
 * @returns Promise resolving to a data URL string
 */
export async function generateQRCode(
	text: string,
	options?: {
		width?: number
		margin?: number
		color?: {
			dark?: string
			light?: string
		}
	},
): Promise<string> {
	try {
		const dataUrl = await QRCode.toDataURL(text, {
			width: options?.width ?? 200,
			margin: options?.margin ?? 2,
			color: {
				dark: options?.color?.dark ?? "#000000",
				light: options?.color?.light ?? "#FFFFFF",
			},
		})
		return dataUrl
	} catch (error) {
		console.error("Failed to generate QR code:", error)
		throw new Error(`Failed to generate QR code: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Generate a QR code as an SVG string
 * @param text The text to encode in the QR code
 * @param options QR code generation options
 * @returns Promise resolving to an SVG string
 */
export async function generateQRCodeSVG(
	text: string,
	options?: {
		width?: number
		margin?: number
		color?: {
			dark?: string
			light?: string
		}
	},
): Promise<string> {
	try {
		const svg = await QRCode.toString(text, {
			type: "svg",
			width: options?.width ?? 200,
			margin: options?.margin ?? 2,
			color: {
				dark: options?.color?.dark ?? "#000000",
				light: options?.color?.light ?? "#FFFFFF",
			},
		})
		return svg
	} catch (error) {
		console.error("Failed to generate QR code SVG:", error)
		throw new Error(`Failed to generate QR code SVG: ${error instanceof Error ? error.message : String(error)}`)
	}
}
