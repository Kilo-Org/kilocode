import React from "react"
import { useTranslation } from "react-i18next"
import { ImageIcon } from "lucide-react"
import { cn } from "../../../lib/utils"
import { StandardTooltip } from "../../../components/ui"

interface AddImageButtonProps {
	onClick: () => void
	onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
	fileInputRef: React.RefObject<HTMLInputElement>
	acceptedMimeTypes: string
	disabled?: boolean
}

/**
 * Reusable button for adding images from file browser.
 * Used in ChatInput and NewAgentForm.
 * Includes a hidden file input that opens on button click.
 */
export const AddImageButton: React.FC<AddImageButtonProps> = ({
	onClick,
	onFileSelect,
	fileInputRef,
	acceptedMimeTypes,
	disabled = false,
}) => {
	const { t } = useTranslation("agentManager")

	return (
		<>
			<input
				ref={fileInputRef}
				type="file"
				accept={acceptedMimeTypes}
				multiple
				onChange={onFileSelect}
				className="hidden"
				aria-hidden="true"
			/>
			<StandardTooltip content={t("chatInput.addImage")}>
				<button
					type="button"
					aria-label={t("chatInput.addImage")}
					disabled={disabled}
					onClick={onClick}
					className={cn(
						"relative inline-flex items-center justify-center",
						"bg-transparent border-none p-1.5",
						"rounded-md min-w-[28px] min-h-[28px]",
						"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
						"transition-all duration-150",
						"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
						"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						"active:bg-[rgba(255,255,255,0.1)]",
						!disabled && "cursor-pointer",
						disabled &&
							"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
					)}>
					<ImageIcon size={14} />
				</button>
			</StandardTooltip>
		</>
	)
}
