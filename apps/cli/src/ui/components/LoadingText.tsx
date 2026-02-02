import { Spinner } from "@inkjs/ui"
import { memo, useMemo } from "react"

const THINKING_PHRASES = [
	"Thinking",
	"Pondering",
	"Contemplating",
	"Reticulating",
	"Marinating",
	"Actualizing",
	"Crunching",
	"Untangling",
	"Summoning",
	"Conjuring",
	"Materializing",
	"Synthesizing",
	"Assembling",
	"Percolating",
	"Brewing",
	"Manifesting",
	"Cogitating",
]

interface LoadingTextProps {
	children?: React.ReactNode
}

function LoadingText({ children }: LoadingTextProps) {
	const randomPhrase = useMemo(() => {
		const randomIndex = Math.floor(Math.random() * THINKING_PHRASES.length)
		return THINKING_PHRASES[randomIndex]
	}, [])

	const childrenStr = children ? String(children) : ""
	const useRandomPhrase = !children || childrenStr === "Thinking"
	const label = useRandomPhrase ? `${randomPhrase}...` : `${childrenStr}...`

	return <Spinner label={label} />
}

export default memo(LoadingText)
