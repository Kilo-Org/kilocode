package ai.kilocode.client.vfs

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.util.CheckedDisposable
import com.intellij.openapi.util.UserDataHolderBase
import java.beans.PropertyChangeListener
import java.beans.PropertyChangeSupport

abstract class KiloFileEditorBase : UserDataHolderBase(), FileEditor, CheckedDisposable {
    private var disposed = false
    private val support = PropertyChangeSupport(this)

    override fun isDisposed(): Boolean = disposed

    override fun dispose() {
        disposed = true
    }

    override fun isValid(): Boolean = !disposed

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {
        support.addPropertyChangeListener(listener)
    }

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {
        support.removePropertyChangeListener(listener)
    }

    override fun getState(level: FileEditorStateLevel): FileEditorState = FileEditorState.INSTANCE
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
}
