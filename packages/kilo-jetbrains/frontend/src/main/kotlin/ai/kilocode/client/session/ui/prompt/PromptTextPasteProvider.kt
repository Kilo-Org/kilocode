package ai.kilocode.client.session.ui.prompt

import com.intellij.ide.PasteProvider
import com.intellij.ide.dnd.FileCopyPasteUtil
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.actions.PasteAction
import com.intellij.openapi.util.Key
import java.awt.datatransfer.DataFlavor

internal fun interface PromptTextPasteHandler {
    fun paste(text: String)
}

internal val PROMPT_TEXT_PASTE_HANDLER_KEY: Key<PromptTextPasteHandler> =
    Key.create("ai.kilocode.client.session.ui.prompt.PromptTextPasteHandler")

/**
 * Claims plain-text pastes large enough to collapse ([collapsible]) inside a Kilo prompt editor,
 * leaving every other paste (files, images, short text) to IntelliJ's default paste handling.
 */
internal class PromptTextPasteProvider : PasteProvider {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun isPastePossible(dataContext: DataContext): Boolean = text(dataContext) != null

    override fun isPasteEnabled(dataContext: DataContext): Boolean = isPastePossible(dataContext)

    override fun performPaste(dataContext: DataContext) {
        val editor = dataContext.getData(CommonDataKeys.EDITOR) ?: return
        val handler = editor.getUserData(PROMPT_TEXT_PASTE_HANDLER_KEY) ?: return
        val value = text(dataContext) ?: return
        handler.paste(value)
    }

    private fun text(dataContext: DataContext): String? {
        val editor = dataContext.getData(CommonDataKeys.EDITOR) ?: return null
        if (editor.getUserData(PROMPT_TEXT_PASTE_HANDLER_KEY) == null) return null
        val item = dataContext.getData(PasteAction.TRANSFERABLE_PROVIDER)?.produce() ?: return null
        if (!item.isDataFlavorSupported(DataFlavor.stringFlavor)) return null
        if (FileCopyPasteUtil.isFileListFlavorAvailable(item.transferDataFlavors)) return null
        if (item.isDataFlavorSupported(DataFlavor.imageFlavor)) return null
        val value = item.getTransferData(DataFlavor.stringFlavor) as? String ?: return null
        return value.takeIf(::collapsible)
    }
}
