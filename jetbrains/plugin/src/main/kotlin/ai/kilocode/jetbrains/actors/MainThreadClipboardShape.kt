// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import java.awt.Toolkit
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.StringSelection

/**
 * Main thread clipboard interface.
 * Corresponds to the MainThreadClipboardShape interface in VSCode.
 */
interface MainThreadClipboardShape : Disposable {
    /**
     * Reads text from the clipboard.
     * @return The string from the clipboard, or null if no text is available
     */
    fun readText(): String?

    /**
     * Writes text to the clipboard.
     * @param value The string to write to the clipboard
     */
    fun writeText(value: String?)
}

/**
 * Implementation of the MainThreadClipboardShape interface.
 * Provides functionality to read from and write to the system clipboard.
 */
class MainThreadClipboard : MainThreadClipboardShape {
    private val logger = Logger.getInstance(MainThreadClipboardShape::class.java)

    /**
     * Reads text from the system clipboard.
     *
     * @return The string from the clipboard, or null if no text is available or an error occurs
     */
    override fun readText(): String? {
        logger.info("Reading clipboard text")
        return try {
            val clipboard = Toolkit.getDefaultToolkit().systemClipboard
            val data = clipboard.getContents(null)
            if (data != null && data.isDataFlavorSupported(DataFlavor.stringFlavor)) {
                data.getTransferData(DataFlavor.stringFlavor) as? String
            } else {
                null
            }
        } catch (e: Exception) {
            logger.error("Failed to read clipboard", e)
            null
        }
    }

    /**
     * Writes text to the system clipboard.
     *
     * @param value The string to write to the clipboard
     */
    override fun writeText(value: String?) {
        value?.let {
            logger.info("Writing clipboard text: $value")
            try {
                val clipboard = Toolkit.getDefaultToolkit().systemClipboard
                val selection = StringSelection(value)
                clipboard.setContents(selection, selection)
            } catch (e: Exception) {
                logger.error("Failed to write to clipboard", e)
            }
        }
    }

    /**
     * Releases resources used by this clipboard handler.
     */
    override fun dispose() {
        logger.info("Releasing resources: MainThreadClipboard")
    }
}
