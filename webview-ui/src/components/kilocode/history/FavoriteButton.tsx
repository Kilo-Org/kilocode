import { vscode } from "@/utils/vscode"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const FavoriteButton = ({ id, isFavorited }: { id: string; isFavorited: boolean }) => {
	const { t } = useAppTranslation()

	return (
		<Button
			variant="ghost"
			size="icon"
			title={isFavorited ? t("history:unfavoriteTask") : t("history:favoriteTask")}
			data-testid="favorite-task-button"
			onClick={(e: React.MouseEvent) => {
				e.stopPropagation()
				vscode.postMessage({ type: "toggleTaskFavorite", text: id })
			}}
			className={`group-hover:opacity-100 transition-opacity ${isFavorited ? "opacity-70" : "opacity-50"}`}>
			<span className={`codicon ${isFavorited ? "codicon-star-full" : "codicon-star-empty"}`} />
		</Button>
	)
}
