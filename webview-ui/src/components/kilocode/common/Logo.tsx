import { useState } from "react"

export default function Logo({ width = 80, height = 80 }: { width?: number; height?: number }) {
	const [iconsBaseUri] = useState(() => {
		const w = window as any
		return w.ICONS_BASE_URI || ""
	})

	return (
		<img
			src={iconsBaseUri + "/axon-code.svg"}
			alt="Axon Code Logo"
			width={width}
			height={height}
			className="mb-4 mt-4"
		/>
	)
}
