package ai.kilocode.client.session.ui.prompt

import com.intellij.ide.PasteProvider
import com.intellij.ide.dnd.FileCopyPasteUtil
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.actions.PasteAction
import com.intellij.openapi.util.Key
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.Transferable

internal fun interface PromptAttachmentPasteHandler {
    fun paste(transferable: Transferable)
}

internal val PROMPT_ATTACHMENT_PASTE_HANDLER_KEY: Key<PromptAttachmentPasteHandler> =
    Key.create("ai.kilocode.client.session.ui.prompt.PromptAttachmentPasteHandler")

internal class PromptAttachmentPasteProvider : PasteProvider {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun isPastePossible(dataContext: DataContext): Boolean = transferable(dataContext) != null

    override fun isPasteEnabled(dataContext: DataContext): Boolean = isPastePossible(dataContext)

    override fun performPaste(dataContext: DataContext) {
        val editor = dataContext.getData(CommonDataKeys.EDITOR) ?: return
        val handler = editor.getUserData(PROMPT_ATTACHMENT_PASTE_HANDLER_KEY) ?: return
        val item = transferable(dataContext) ?: return
        handler.paste(item)
    }

    private fun transferable(dataContext: DataContext): Transferable? {
        val editor = dataContext.getData(CommonDataKeys.EDITOR) ?: return null
        if (editor.getUserData(PROMPT_ATTACHMENT_PASTE_HANDLER_KEY) == null) return null
        val item = dataContext.getData(PasteAction.TRANSFERABLE_PROVIDER)?.produce() ?: return null
        if (FileCopyPasteUtil.isFileListFlavorAvailable(item.transferDataFlavors)) return item
        if (item.isDataFlavorSupported(DataFlavor.imageFlavor)) return item
        return null
    }
}
