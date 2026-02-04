declare module "*.png" {
	const content: import("next/image").StaticImageData
	export default content
}

declare module "*.jpg" {
	const content: import("next/image").StaticImageData
	export default content
}

declare module "*.jpeg" {
	const content: import("next/image").StaticImageData
	export default content
}

declare module "*.svg" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Next.js built-in SVG type to avoid conflicts with @svgr/webpack
	const content: any
	export default content
}

declare module "*.gif" {
	const content: import("next/image").StaticImageData
	export default content
}

declare module "*.webp" {
	const content: import("next/image").StaticImageData
	export default content
}
