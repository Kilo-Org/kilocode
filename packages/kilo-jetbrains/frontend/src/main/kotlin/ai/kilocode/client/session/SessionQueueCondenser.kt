package ai.kilocode.client.session

import ai.kilocode.rpc.dto.ChatEventDto

/**
 * Reduces a batch of queued [ChatEventDto] events before they are flushed to
 * the model, by merging consecutive same-key snapshot and text-delta events.
 *
 * ## Algorithm
 *
 * Events are scanned in arrival order. Three ordered accumulators hold
 * mergeable events keyed by their identity. Any non-mergeable event acts as a
 * **barrier** — all accumulated events are flushed into the output before the
 * barrier event is appended. This preserves the original ordering while
 * collapsing N updates into one per key per batch.
 *
 * ## What is merged
 *
 * - `ChatEventDto.PartDelta` where `field == "text"` and same
 *   `(sessionId, messageId, partId, field)` key. Text is concatenated.
 * - `ChatEventDto.PartUpdated` for the same `(sessionId, messageId, partId)`.
 *   Latest snapshot wins.
 * - `ChatEventDto.MessageUpdated` for the same `messageId`.
 *   Latest snapshot wins.
 * - `ChatEventDto.SessionStatusChanged` for the same `sessionId`.
 *   Latest snapshot wins.
 * - `ChatEventDto.SessionDiffChanged` for the same `sessionId`.
 *   Latest snapshot wins.
 *
 * ## What is not merged
 *
 * - `PartDelta` for non-text fields
 * - `PartDelta` and `PartUpdated` do not merge across each other
 * - No event merges across a barrier (TurnOpen, TurnClose, Error, etc.)
 *
 * ## Drain order
 *
 * When a barrier is encountered or the batch ends, accumulators drain in this
 * order: state events first, then part updates, then text deltas. This ensures
 * a message is always flushed before the part updates that depend on it.
 */
internal class SessionQueueCondenser {

    fun condense(events: List<ChatEventDto>): List<ChatEventDto> {
        if (events.size < 2) return events
        val out = mutableListOf<ChatEventDto>()
        val deltas = LinkedHashMap<String, ChatEventDto.PartDelta>()
        val parts = LinkedHashMap<String, ChatEventDto.PartUpdated>()
        val states = LinkedHashMap<String, ChatEventDto>()

        fun drainDeltas() {
            if (deltas.isEmpty()) return
            out.addAll(deltas.values)
            deltas.clear()
        }

        fun drainParts() {
            if (parts.isEmpty()) return
            out.addAll(parts.values)
            parts.clear()
        }

        fun drainStates() {
            if (states.isEmpty()) return
            out.addAll(states.values)
            states.clear()
        }

        fun drain() {
            drainStates()
            drainParts()
            drainDeltas()
        }

        for (event in events) {
            when (event) {
                is ChatEventDto.PartDelta -> {
                    val key = event.key()
                    if (key == null) {
                        drain()
                        out.add(event)
                        continue
                    }
                    drainParts()
                    drainStates()
                    val prev = deltas[key]
                    deltas[key] = if (prev != null) prev.merge(event) else event
                }

                is ChatEventDto.PartUpdated -> {
                    drainDeltas()
                    drainStates()
                    parts[event.key()] = event
                }

                is ChatEventDto.MessageUpdated -> {
                    drainDeltas()
                    drainParts()
                    states["MU:${event.info.id}"] = event
                }

                is ChatEventDto.SessionStatusChanged -> {
                    drainDeltas()
                    drainParts()
                    states["SC:${event.sessionID}"] = event
                }

                is ChatEventDto.SessionDiffChanged -> {
                    drainDeltas()
                    drainParts()
                    states["SDC:${event.sessionID}"] = event
                }

                else -> {
                    drain()
                    out.add(event)
                }
            }
        }

        drain()
        return out
    }

    private fun ChatEventDto.PartDelta.key(): String? {
        if (field != "text") return null
        return "$sessionID:$messageID:$partID:$field"
    }

    private fun ChatEventDto.PartUpdated.key(): String =
        "$sessionID:${part.messageID}:${part.id}"

    private fun ChatEventDto.PartDelta.merge(next: ChatEventDto.PartDelta): ChatEventDto.PartDelta =
        ChatEventDto.PartDelta(next.sessionID, next.messageID, next.partID, next.field, delta + next.delta)
}
