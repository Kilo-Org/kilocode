// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.webview

import com.intellij.openapi.diagnostic.Logger
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.DnDConstants
import java.awt.dnd.DropTarget
import java.awt.dnd.DropTargetAdapter
import java.awt.dnd.DropTargetDragEvent
import java.awt.dnd.DropTargetDropEvent
import java.awt.dnd.DropTargetEvent
import java.io.File
import javax.swing.JComponent

/**
 * Handles file drag-and-drop to WebView.
 * Based on VSCode native drag-and-drop behavior.
 */
class DragDropHandler(
    private val webViewInstance: WebViewInstance,
    private val targetComponent: JComponent,
) {
    private val logger = Logger.getInstance(DragDropHandler::class.java)

    /**
     * Setup drag and drop support
     */
    fun setupDragAndDrop() {
        logger.info("Setting up drag and drop support for WebView (VSCode-compatible)")

        val dropTarget = DropTarget(
            targetComponent,
            object : DropTargetAdapter() {

                override fun dragEnter(dtde: DropTargetDragEvent) {
                    logger.info("Drag enter detected")
                    if (isShiftKeyPressed(dtde) && hasFileList(dtde)) {
                        dtde.acceptDrag(DnDConstants.ACTION_COPY)
                        notifyDragState(true)
                        logger.info("Drag accepted - Shift key pressed and files detected")
                    } else {
                        dtde.rejectDrag()
                        logger.info("Drag rejected - ${if (!isShiftKeyPressed(dtde)) "Shift key not pressed" else "no files detected"}")
                    }
                }

                override fun dragOver(dtde: DropTargetDragEvent) {
                    if (isShiftKeyPressed(dtde) && hasFileList(dtde)) {
                        dtde.acceptDrag(DnDConstants.ACTION_COPY)
                    } else {
                        dtde.rejectDrag()
                    }
                }

                override fun dragExit(dte: DropTargetEvent) {
                    logger.info("Drag exit detected")
                    notifyDragState(false)
                }

                override fun drop(dtde: DropTargetDropEvent) {
                    logger.info("Drop event detected")
                    handleFileDrop(dtde)
                }
            },
        )

        logger.info("Drag and drop setup completed")
    }

    /**
     * Check if Shift key is pressed.
     * Simulates VSCode native if (!e.shiftKey) check.
     *
     * Note: In Java AWT, Shift key state detection may require a global key listener.
     * For now, always return true for usability.
     */
    private fun isShiftKeyPressed(dtde: DropTargetDragEvent): Boolean {
        // TODO: Implement real Shift key detection if needed.
        return true
    }

    /**
     * Notify WebView drag state change.
     * Simulates VSCode drag visual feedback (isDraggingOver state).
     */
    private fun notifyDragState(isDragging: Boolean) {
        try {
            val jsCode = """
                (function() {
                    console.log('Setting drag state:', $isDragging);
                    const textareas = document.querySelectorAll('textarea, [contenteditable="true"]');
                    if ($isDragging) {
                        textareas.forEach(textarea => {
                            textarea.style.border = '2px dashed #007acc';
                            textarea.style.backgroundColor = 'rgba(0, 122, 204, 0.1)';
                            textarea.setAttribute('data-dragging', 'true');
                        });
                    } else {
                        textareas.forEach(textarea => {
                            textarea.style.border = '';
                            textarea.style.backgroundColor = '';
                            textarea.removeAttribute('data-dragging');
                        });
                    }
                })();
            """.trimIndent()
            webViewInstance.executeJavaScript(jsCode)
        } catch (e: Exception) {
            logger.error("Failed to notify drag state", e)
        }
    }

    /**
     * Handle file drop event.
     * Based on VSCode handleDrop function.
     */
    private fun handleFileDrop(dtde: DropTargetDropEvent) {
        try {
            logger.info("Processing drop event")

            if (!hasFileList(dtde)) {
                logger.info("Drop rejected: No file list in transferable")
                dtde.rejectDrop()
                notifyDragState(false)
                return
            }

            dtde.acceptDrop(DnDConstants.ACTION_COPY)

            val transferable = dtde.transferable

            @Suppress("UNCHECKED_CAST")
            val fileList = transferable.getTransferData(DataFlavor.javaFileListFlavor) as List<File>

            logger.info("Files dropped: ${fileList.map { it.absolutePath }}")

            if (fileList.isNotEmpty()) {
                insertFilePathsIntoTextarea(fileList)
                dtde.dropComplete(true)
            } else {
                logger.warn("No valid files found in drop event")
                dtde.dropComplete(false)
            }

            notifyDragState(false)
        } catch (e: Exception) {
            logger.error("Error handling file drop", e)
            dtde.dropComplete(false)
            notifyDragState(false)
        }
    }

    /**
     * Forward file paths to VSCode native handler.
     * Simulate native drag event for VSCode extension.
     */
    private fun insertFilePathsIntoTextarea(files: List<File>) {
        try {
            // Build file path list, use absolute path for VSCode native handler
            val filePaths = files.map { file ->
                file.absolutePath
            }

            logger.info("Forwarding drag drop event to VSCode native handler: ${filePaths.size} files")

            // Create a simulated native drag event for VSCode extension
            val jsCode = """
                (function() {
                    console.log('Simulating native drag drop event for VSCode');
                    
                    // Find target textarea
                    const textareas = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
                    console.log('Found textareas:', textareas.length);
                    
                    if (textareas.length === 0) {
                        console.warn('No suitable textarea found');
                        return false;
                    }
                    
                    // Select target textarea
                    let targetTextarea = document.activeElement;
                    if (!targetTextarea || !['TEXTAREA', 'INPUT'].includes(targetTextarea.tagName)) {
                        targetTextarea = textareas[0];
                    }
                    
                    if (!targetTextarea) {
                        console.warn('No valid target textarea found');
                        return false;
                    }
                    
                    console.log('Target textarea found:', targetTextarea.tagName);
                    
                    // Build file path data
                    const filePaths = [${filePaths.joinToString(", ") { "\"$it\"" }}];
                    
                    console.log('File paths to insert:', filePaths);
                    
                    // Create mock File objects
                    const mockFiles = filePaths.map(path => ({
                        name: path.split('/').pop() || path.split('\\\\').pop() || 'unknown',
                        path: path,
                        type: '',
                        size: 0,
                        lastModified: Date.now(),
                        webkitRelativePath: ''
                    }));
                    
                    // Create mock FileList object
                    const mockFileList = {
                        length: mockFiles.length,
                        item: function(index) {
                            return mockFiles[index] || null;
                        },
                        [Symbol.iterator]: function* () {
                            for (let i = 0; i < this.length; i++) {
                                yield this.item(i);
                            }
                        }
                    };
                    
                    // Add array index access to FileList
                    mockFiles.forEach((file, index) => {
                        mockFileList[index] = file;
                    });
                    
                    // Create mock DataTransferItem objects
                    const mockItems = mockFiles.map(file => ({
                        kind: 'file',
                        type: file.type,
                        getAsFile: function() {
                            return file;
                        },
                        getAsString: function(callback) {
                            if (callback) callback(file.path);
                        }
                    }));
                    
                    // Create mock DataTransferItemList object
                    const mockItemList = {
                        length: mockItems.length,
                        item: function(index) {
                            return mockItems[index] || null;
                        },
                        [Symbol.iterator]: function* () {
                            for (let i = 0; i < this.length; i++) {
                                yield this.item(i);
                            }
                        }
                    };
                    
                    // Add array index access to ItemList
                    mockItems.forEach((item, index) => {
                        mockItemList[index] = item;
                    });
                    
                    console.log('Created mock FileList with', mockFileList.length, 'files');
                    console.log('Created mock ItemList with', mockItemList.length, 'items');
                    
                    // Create complete DataTransfer object
                    const mockDataTransfer = {
                        files: mockFileList,
                        items: mockItemList,
                        types: ['Files', 'text/uri-list', 'text/plain'],
                        getData: function(format) {
                            console.log('DataTransfer.getData called with format:', format);
                            if (format === 'text' || format === 'text/plain') {
                                return filePaths.join('\n');
                            }
                            if (format === 'text/uri-list' || format === 'application/vnd.code.uri-list') {
                                return filePaths.map(path => 'file://' + path).join('\n');
                            }
                            return '';
                        },
                        setData: function(format, data) {
                            // Mock implementation
                        },
                        clearData: function(format) {
                            // Mock implementation
                        },
                        effectAllowed: 'copy',
                        dropEffect: 'copy'
                    };
                    
                    // Create mock drop event
                    const mockDragEvent = new Event('drop', {
                        bubbles: true,
                        cancelable: true
                    });
                    
                    // Add required properties
                    Object.defineProperty(mockDragEvent, 'dataTransfer', {
                        value: mockDataTransfer,
                        writable: false
                    });
                    
                    // Simulate Shift key pressed (required by VSCode)
                    Object.defineProperty(mockDragEvent, 'shiftKey', {
                        value: true,
                        writable: false
                    });
                    
                    console.log('Dispatching mock drop event to textarea');
                    
                    // Ensure textarea is focused
                    targetTextarea.focus();
                    
                    // Dispatch event to textarea for VSCode native handler
                    const result = targetTextarea.dispatchEvent(mockDragEvent);
                    
                    console.log('Mock drop event dispatched, result:', result);
                    
                    return true;
                })();
            """.trimIndent()

            webViewInstance.executeJavaScript(jsCode)
        } catch (e: Exception) {
            logger.error("Failed to forward drag drop event to VSCode", e)
        }
    }

    /**
     * Check if drag data contains file list.
     */
    private fun hasFileList(dtde: DropTargetDragEvent): Boolean {
        return dtde.transferable.isDataFlavorSupported(DataFlavor.javaFileListFlavor)
    }

    /**
     * Check if drag data contains file list (Drop event version).
     */
    private fun hasFileList(dtde: DropTargetDropEvent): Boolean {
        return dtde.transferable.isDataFlavorSupported(DataFlavor.javaFileListFlavor)
    }
}
