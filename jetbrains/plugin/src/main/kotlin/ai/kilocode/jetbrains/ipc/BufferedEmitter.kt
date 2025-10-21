// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Buffered event emitter
 * Ensures messages are not lost when there are no event listeners
 * Corresponds to BufferedEmitter in VSCode
 * @param T Event data type
 */
class BufferedEmitter<T> {
    private val listeners = mutableListOf<(T) -> Unit>()
    private val bufferedMessages = ConcurrentLinkedQueue<T>()
    private var hasListeners = false
    private var isDeliveringMessages = false

    private val coroutineContext = Dispatchers.IO
    private val scope = CoroutineScope(coroutineContext)

    companion object {
        private val LOG = Logger.getInstance(BufferedEmitter::class.java)
    }

    /**
     * Event listener property, similar to the event property in TypeScript version
     */
    val event: EventListener<T> = this::onEvent

    /**
     * Add event listener
     * @param listener Event listener
     * @return Listener registration identifier for removing the listener
     */
    fun onEvent(listener: (T) -> Unit): Disposable {
        val wasEmpty = listeners.isEmpty()
        listeners.add(listener)

        if (wasEmpty) {
            hasListeners = true
            // Use microtask queue to ensure these messages are delivered before other messages have a chance to be received
            scope.launch { deliverMessages() }
        }

        return Disposable {
            synchronized(listeners) {
                listeners.remove(listener)
                if (listeners.isEmpty()) {
                    hasListeners = false
                }
            }
        }
    }

    /**
     * Fire event
     * @param event Event data
     */
    fun fire(event: T) {
        if (hasListeners) {
            if (bufferedMessages.isNotEmpty()) {
                bufferedMessages.offer(event)
            } else {
                synchronized(listeners) {
                    ArrayList(listeners).forEach { listener ->
                        try {
                            listener(event)
                        } catch (e: Exception) {
                            // Log exception but do not interrupt processing
                            LOG.warn("Error in event listener: ${e.message}", e)
                        }
                    }
                }
            }
        } else {
            bufferedMessages.offer(event)
        }
    }

    /**
     * Clear buffer
     */
    fun flushBuffer() {
        bufferedMessages.clear()
    }

    /**
     * Deliver buffered messages
     */
    private fun deliverMessages() {
        if (isDeliveringMessages) {
            return
        }

        isDeliveringMessages = true
        try {
            while (hasListeners && bufferedMessages.isNotEmpty()) {
                val event = bufferedMessages.poll() ?: break
                synchronized(listeners) {
                    ArrayList(listeners).forEach { listener ->
                        try {
                            listener(event)
                        } catch (e: Exception) {
                            // Log exception but do not interrupt processing
                            LOG.warn("Error in event listener: ${e.message}", e)
                        }
                    }
                }
            }
        } finally {
            isDeliveringMessages = false
        }
    }
}

/**
 * Event listener type alias
 */
typealias EventListener<T> = ((T) -> Unit) -> Disposable
