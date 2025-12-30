// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.events

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

@Service
class EventBus : AbsEventBus() {
    companion object {
        fun get(): EventBus {
            return service<EventBus>()
        }
    }
}

/**
 * Event bus for communication between plugin internal components
 */
@Service(Service.Level.PROJECT) // Consider other implementation approaches?
class ProjectEventBus : AbsEventBus()

open class AbsEventBus : Disposable {
    private val logger = Logger.getInstance(ProjectEventBus::class.java)

    // All events are dispatched through this flow
    private val _events = MutableSharedFlow<Event<*>>(extraBufferCapacity = 64)
    val events: SharedFlow<Event<*>> = _events.asSharedFlow()

    // Event listener mapping, key is event type, value is listener list
    private val listeners = ConcurrentHashMap<EventType<*>, MutableList<(Any) -> Unit>>()

    /**
     * Send event
     */
    suspend fun <T : Any> emit(eventType: EventType<T>, data: T) {
        _events.emit(Event(eventType, data))

        // Also notify regular listeners
        @Suppress("UNCHECKED_CAST")
        listeners[eventType]?.forEach { listener ->
            try {
                listener(data)
            } catch (e: Exception) {
                logger.error("Event handling exception", e)
            }
        }
    }

    /**
     * Send event in specified coroutine scope
     */
    fun <T : Any> emitIn(scope: CoroutineScope, eventType: EventType<T>, data: T) {
        scope.launch {
            emit(eventType, data)
        }
    }

    /**
     * Send event in IntelliJ application context
     * Use IntelliJ platform's thread-safe methods instead of coroutines
     */
    fun <T : Any> emitInApplication(eventType: EventType<T>, data: T) {
        ApplicationManager.getApplication().invokeLater {
            ApplicationManager.getApplication().runReadAction {
                listeners[eventType]?.forEach { listener ->
                    @Suppress("UNCHECKED_CAST")
                    try {
                        listener(data)
                    } catch (e: Exception) {
                        logger.error("Event processing exception", e)
                    }
                }
            }
        }
    }

    /**
     * Subscribe to specific event type in specified coroutine scope
     */
    inline fun <reified T : Any> on(
        scope: CoroutineScope,
        eventType: EventType<T>,
        crossinline handler: suspend (T) -> Unit,
    ) {
        scope.launch {
            events
                .filter { it.type == eventType }
                .collect { event ->
                    @Suppress("UNCHECKED_CAST")
                    handler(event.data as T)
                }
        }
    }

    /**
     * Add event listener (no coroutines required)
     * Provides IntelliJ platform compatible event listening method
     */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> addListener(eventType: EventType<T>, handler: (T) -> Unit) {
        listeners.getOrPut(eventType) { mutableListOf() }.add(handler as (Any) -> Unit)
    }

    /**
     * Add event listener with Disposable, automatically removes listener when Disposable is disposed
     */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> addListener(eventType: EventType<T>, disposable: Disposable, handler: (T) -> Unit) {
        val wrappedHandler = handler as (Any) -> Unit
        listeners.getOrPut(eventType) { mutableListOf() }.add(wrappedHandler)

        // Use IntelliJ's Disposer API for resource cleanup
        Disposer.register(
            disposable,
            Disposable {
                removeListener(eventType, wrappedHandler)
            },
        )
    }

    /**
     * Remove event listener
     */
    fun <T : Any> removeListener(eventType: EventType<T>, handler: (Any) -> Unit) {
        listeners[eventType]?.remove(handler)
    }

    /**
     * Remove all listeners for specific event type
     */
    fun <T : Any> removeAllListeners(eventType: EventType<T>) {
        listeners.remove(eventType)
    }

    override fun dispose() {
        logger.info("Disposing EventBus, clearing ${listeners.size} listener types")
        
        // Clear all listeners to prevent memory leaks
        listeners.clear()
        
        logger.info("EventBus disposed")
    }
}

/**
 * Event type marker interface
 */
interface EventType<T : Any>

/**
 * Event data class
 */
data class Event<T : Any>(
    val type: EventType<T>,
    val data: T,
)
