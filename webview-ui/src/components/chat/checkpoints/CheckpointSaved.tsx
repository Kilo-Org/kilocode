import { useMemo, useRef, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"
import { GitCommitVertical } from "lucide-react"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
}

export const CheckpointSaved = ({ checkpoint, currentHash, ...props }: CheckpointSavedProps) => {
	const { t } = useTranslation()
	const isCurrent = currentHash === props.commitHash
	const [isPopoverOpen, setIsPopoverOpen] = useState(false)
	const [isClosing, setIsClosing] = useState(false)
	const [isHovering, setIsHovering] = useState(false)
	const closeTimer = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		}
	}, [])

	const handlePopoverOpenChange = (open: boolean) => {
		setIsPopoverOpen(open)
		if (open) {
			setIsClosing(false)
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		} else {
			setIsClosing(true)
			closeTimer.current = window.setTimeout(() => {
				setIsClosing(false)
				closeTimer.current = null
			}, 200) // keep menu visible briefly to avoid popover jump
		}
	}

	const handleMouseEnter = () => {
		setIsHovering(true)
	}

	const handleMouseLeave = () => {
		setIsHovering(false)
	}

	// Menu is visible when hovering, popover is open, or briefly after popover closes
	const menuVisible = isHovering || isPopoverOpen || isClosing

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success) {
			return undefined
		}

		// kilocode_change start
		// ifFirst is misscalculated by the ShadowCheckpointService because use the length of the array of checkpoints
		// insead of the from-to attributes.
		// ifFirst need to be removed from the checkpointShema and the core pkg and move the logic to the frontend
		return {
			...result.data,
			isFirst: result.data.from === result.data.to,
		}
		// kilocode_change end
	}, [checkpoint])

	if (!metadata) {
		return null
	}

	// kilocode_change start: muted styling with theme-aware colors and hover opacity
	return (
		<div
			className="flex items-center justify-between gap-2 opacity-40 hover:opacity-100 transition-opacity"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}>
			<div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
				<GitCommitVertical className="w-4" />
				<span className="text-sm">{t("chat:checkpoint.regular")}</span>
				{isCurrent && <span className="text-muted">({t("chat:checkpoint.current")})</span>}
			</div>
			<span
				className="block w-full h-[2px] mt-[2px] text-xs"
				style={{
					backgroundImage:
						"linear-gradient(90deg, color-mix(in srgb, var(--vscode-editorGroup-border) 65%, transparent), color-mix(in srgb, var(--vscode-editorGroup-border) 65%, transparent) 80%, transparent 99%)",
				}}></span>
			{/* kilocode_change end */}

			{/* Keep menu visible while hovering, popover is open, or briefly after close to prevent jump */}
			<div data-testid="checkpoint-menu-container" className={cn("h-4 -mt-2", menuVisible ? "block" : "hidden")}>
				<CheckpointMenu
					ts={props.ts}
					commitHash={props.commitHash}
					checkpoint={metadata}
					onOpenChange={handlePopoverOpenChange}
				/>
			</div>
		</div>
	)
}
