package ai.kilocode.client.session.ui.editor

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SendPromptContext
import ai.kilocode.client.session.ui.selection.SessionSelection
import com.intellij.ide.actions.UndoRedoAction
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.command.undo.UndoManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.PlainTextLanguage
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.ui.LanguageTextField
import com.intellij.util.textCompletion.TextCompletionProvider
import com.intellij.util.textCompletion.TextCompletionUtil
import com.intellij.util.ui.update.UiNotifyConnector
import java.awt.Component
import java.awt.Container

// The toolbar class is internal; match by name to avoid linking against internal API.
private const val TOOLBAR = "com.intellij.openapi.editor.toolbar.floating.EditorFloatingToolbar"

/**
 * A session-scoped [EditorTextField] for plain-text input.
 *
 * When [ctx] is non-null the component injects it into the data context so
 * shortcut-based send/stop actions work (prompt use-case). When [ctx] is null
 * the component does not expose [PromptDataKeys.SEND], preventing accidental
 * `SendPromptAction` dispatch from question custom-answer editors.
 *
 * Both instances are created on the EDT. The underlying [EditorTextField]
 * lazily initializes its IntelliJ editor the first time the component becomes
 * visible; that initialization calls `EditorThreading.compute` internally,
 * satisfying the platform's read-context requirement without additional
 * wrapping here.
 */
internal open class SessionEditorTextField(
    private val project: Project,
    private val ctx: SendPromptContext? = null,
    completion: TextCompletionProvider? = null,
    private val selection: SessionSelection? = null,
) : EditorTextField(
    completion?.let {
        LanguageTextField.createDocument(
            "",
            PlainTextLanguage.INSTANCE,
            project,
            TextCompletionUtil.DocumentWithCompletionCreator(it, true),
        )
    },
    project,
    PlainTextFileType.INSTANCE,
) {
    private val undo = action(KiloBundle.message("session.editor.undo"), true)
    private val redo = action(KiloBundle.message("session.editor.redo"), false)

    init {
        addSettingsProvider(::install)
    }

    override fun uiDataSnapshot(sink: DataSink) {
        super.uiDataSnapshot(sink)
        selection?.provideCopy(sink) { text }
        ctx?.let { sink.set(PromptDataKeys.SEND, it) }
        file()?.let { sink.set(PlatformCoreDataKeys.FILE_EDITOR, it) }
    }

    private fun install(editor: Editor) {
        (editor as? EditorEx)?.setEmbeddedIntoDialogWrapper(true)
        // EditorImpl lazily creates EditorFloatingToolbar with the same first-show hook.
        // Settings providers run later, so this callback runs immediately after toolbar creation.
        UiNotifyConnector.doWhenFirstShown(editor.component) { hide(editor.component) }
        editor.contentComponent.putClientProperty(UndoRedoAction.IGNORE_SWING_UNDO_MANAGER, true)
        // Workaround: global $Undo/$Redo can miss the synthetic FileEditor for this embedded
        // EditorTextField. Bind the shortcuts locally until the platform data context targets it reliably.
        val manager = ActionManager.getInstance()
        manager.getAction(IdeActions.ACTION_UNDO)?.shortcutSet?.let {
            undo.registerCustomShortcutSet(it, editor.contentComponent)
        }
        manager.getAction(IdeActions.ACTION_REDO)?.shortcutSet?.let {
            redo.registerCustomShortcutSet(it, editor.contentComponent)
        }
    }

    private fun action(text: String, undo: Boolean) = object : DumbAwareAction(text) {
        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = available(undo)
        }

        override fun actionPerformed(e: AnActionEvent) {
            if (project.isDisposed) return
            val file = file() ?: return
            val manager = UndoManager.getInstance(project)
            if (undo) {
                if (manager.isUndoAvailable(file)) manager.undo(file)
                return
            }
            if (manager.isRedoAvailable(file)) manager.redo(file)
        }
    }

    private fun available(undo: Boolean): Boolean {
        if (project.isDisposed) return false
        val file = file() ?: return false
        val manager = UndoManager.getInstance(project)
        return if (undo) manager.isUndoAvailable(file) else manager.isRedoAvailable(file)
    }

    private fun file(): TextEditor? {
        return getEditor(false)?.let(TextEditorProvider.getInstance()::getTextEditor)
    }

    private fun hide(component: Component): Boolean {
        if (component.javaClass.name == TOOLBAR) {
            (component as? Disposable)?.let(Disposer::dispose)
            component.parent?.remove(component)
            return true
        }
        if (component !is Container) return false
        val hidden = component.components.fold(false) { removed, child -> hide(child) || removed }
        if (hidden) {
            component.revalidate()
            component.repaint()
        }
        return hidden
    }
}
