import QRCode from "qrcode"

interface QRCodeOptions {
	width?: number
	margin?: number
	color?: {
		dark?: string
		light?: string
	}
}

const DEFAULT_OPTIONS = {
	width: 200,
	margin: 2,
	color: {
		dark: "#000000",
		light: "#FFFFFF",
	},
} as const

function buildQRCodeOptions(options?: QRCodeOptions) {
	return {
		width: options?.width ?? DEFAULT_OPTIONS.width,
		margin: options?.margin ?? DEFAULT_OPTIONS.margin,
		color: {
			dark: options?.color?.dark ?? DEFAULT_OPTIONS.color.dark,
			light: options?.color?.light ?? DEFAULT_OPTIONS.color.light,
		},
	}
}

export async function generateQRCode(text: string, options?: QRCodeOptions): Promise<string> {
	return QRCode.toDataURL(text, buildQRCodeOptions(options))
}

export async function generateQRCodeSVG(text: string, options?: QRCodeOptions): Promise<string> {
	return QRCode.toString(text, {
		type: "svg",
		...buildQRCodeOptions(options),
	})
}
