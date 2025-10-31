// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Argument type enum
 * Corresponds to ArgType in VSCode
 */
enum class ArgType(val value: Int) {
    /**
     * String type
     */
    String(1),

    /**
     * Binary buffer type
     */
    VSBuffer(2),

    /**
     * Serialized object with buffers type
     */
    SerializedObjectWithBuffers(3),

    /**
     * Undefined type
     */
    Undefined(4),
    ;

    companion object {
        /**
         * Get type by value
         */
        fun fromValue(value: Int): ArgType? = values().find { it.value == value }
    }
}

/**
 * Mixed argument type
 */
sealed class MixedArg {
    /**
     * String argument
     */
    data class StringArg(val value: ByteArray) : MixedArg()

    /**
     * Binary buffer argument
     */
    data class VSBufferArg(val value: ByteArray) : MixedArg()

    /**
     * Serialized object with buffers argument
     */
    data class SerializedObjectWithBuffersArg(val value: ByteArray, val buffers: List<ByteArray>) : MixedArg()

    /**
     * Undefined argument
     */
    object UndefinedArg : MixedArg()
}

/**
 * Message buffer
 * Corresponds to MessageBuffer in VSCode
 */
class MessageBuffer private constructor(
    private val buffer: ByteBuffer,
) {
    companion object {
        /**
         * Allocate message buffer of specified size
         */
        fun alloc(type: MessageType, req: Int, messageSize: Int): MessageBuffer {
            // type + req
            val totalSize = messageSize + 1 + 4
            val buffer = ByteBuffer.allocate(totalSize).order(ByteOrder.BIG_ENDIAN)
            val result = MessageBuffer(buffer)
            result.writeUInt8(type.value)
            result.writeUInt32(req)
            return result
        }

        /**
         * Read message buffer from byte array
         */
        fun read(buff: ByteArray, offset: Int): MessageBuffer {
            val buffer = ByteBuffer.wrap(buff).order(ByteOrder.BIG_ENDIAN)
            buffer.position(offset)
            return MessageBuffer(buffer)
        }

        /**
         * UInt8 size
         */
        const val sizeUInt8: Int = 1

        /**
         * UInt32 size
         */
        const val sizeUInt32: Int = 4

        /**
         * Calculate short string size
         */
        fun sizeShortString(str: ByteArray): Int {
            // string length + actual string
            return sizeUInt8 + str.size
        }

        /**
         * Calculate long string size
         */
        fun sizeLongString(str: ByteArray): Int {
            // string length + actual string
            return sizeUInt32 + str.size
        }

        /**
         * Calculate binary buffer size
         */
        fun sizeVSBuffer(buff: ByteArray): Int {
            // buffer length + actual buffer
            return sizeUInt32 + buff.size
        }

        /**
         * Calculate mixed array size
         */
        fun sizeMixedArray(arr: List<MixedArg>): Int {
            var size = 0
            size += 1 // arr length
            for (el in arr) {
                size += 1 // arg type
                when (el) {
                    is MixedArg.StringArg ->
                        size += sizeLongString(el.value)
                    is MixedArg.VSBufferArg ->
                        size += sizeVSBuffer(el.value)
                    is MixedArg.SerializedObjectWithBuffersArg -> {
                        size += sizeUInt32 // buffer count
                        size += sizeLongString(el.value)
                        for (buffer in el.buffers) {
                            size += sizeVSBuffer(buffer)
                        }
                    }
                    is MixedArg.UndefinedArg ->
                        // empty...
                        Unit
                }
            }
            return size
        }
    }

    /**
     * Get underlying buffer
     */
    val bytes: ByteArray
        get() = buffer.array()

    /**
     * Get buffer size
     */
    val byteLength: Int
        get() = buffer.array().size

    /**
     * Write UInt8
     */
    fun writeUInt8(n: Int) {
        buffer.put(n.toByte())
    }

    /**
     * Read UInt8
     */
    fun readUInt8(): Int {
        return buffer.get().toInt() and 0xFF
    }

    /**
     * Write UInt32
     */
    fun writeUInt32(n: Int) {
        buffer.putInt(n)
    }

    /**
     * Read UInt32
     */
    fun readUInt32(): Int {
        return buffer.getInt()
    }

    /**
     * Write short string
     */
    fun writeShortString(str: ByteArray) {
        buffer.put(str.size.toByte())
        buffer.put(str)
    }

    /**
     * Read short string
     */
    fun readShortString(): String {
        val strByteLength = buffer.get().toInt() and 0xFF
        val strBuff = ByteArray(strByteLength)
        buffer.get(strBuff)
        return String(strBuff)
    }

    /**
     * Write long string
     */
    fun writeLongString(str: ByteArray) {
        buffer.putInt(str.size)
        buffer.put(str)
    }

    /**
     * Read long string
     */
    fun readLongString(): String {
        val strByteLength = buffer.getInt()
        val strBuff = ByteArray(strByteLength)
        buffer.get(strBuff)
        return String(strBuff)
    }

    /**
     * Write buffer
     */
    fun writeBuffer(buff: ByteArray) {
        buffer.putInt(buff.size)
        buffer.put(buff)
    }

    /**
     * Write VSBuffer
     */
    fun writeVSBuffer(buff: ByteArray) {
        buffer.putInt(buff.size)
        buffer.put(buff)
    }

    /**
     * Read VSBuffer
     */
    fun readVSBuffer(): ByteArray {
        val buffLength = buffer.getInt()
        val buff = ByteArray(buffLength)
        buffer.get(buff)
        return buff
    }

    /**
     * Write mixed array
     */
    fun writeMixedArray(arr: List<MixedArg>) {
        buffer.put(arr.size.toByte())
        for (el in arr) {
            when (el) {
                is MixedArg.StringArg -> {
                    writeUInt8(ArgType.String.value)
                    writeLongString(el.value)
                }
                is MixedArg.VSBufferArg -> {
                    writeUInt8(ArgType.VSBuffer.value)
                    writeVSBuffer(el.value)
                }
                is MixedArg.SerializedObjectWithBuffersArg -> {
                    writeUInt8(ArgType.SerializedObjectWithBuffers.value)
                    writeUInt32(el.buffers.size)
                    writeLongString(el.value)
                    for (buffer in el.buffers) {
                        writeBuffer(buffer)
                    }
                }
                is MixedArg.UndefinedArg -> {
                    writeUInt8(ArgType.Undefined.value)
                }
            }
        }
    }

    /**
     * Read mixed array
     */
    fun readMixedArray(): List<Any?> {
        val arrLen = readUInt8()
        val arr = ArrayList<Any?>(arrLen)

        for (i in 0 until arrLen) {
            val argType = ArgType.fromValue(readUInt8()) ?: ArgType.Undefined
            when (argType) {
                ArgType.String -> {
                    arr.add(readLongString())
                }
                ArgType.VSBuffer -> {
                    arr.add(readVSBuffer())
                }
                ArgType.SerializedObjectWithBuffers -> {
                    val bufferCount = readUInt32()
                    val jsonString = readLongString()
                    val buffers = ArrayList<ByteArray>(bufferCount)
                    for (j in 0 until bufferCount) {
                        buffers.add(readVSBuffer())
                    }
                    arr.add(SerializableObjectWithBuffers(parseJsonAndRestoreBufferRefs(jsonString, buffers, null)))
                }
                ArgType.Undefined -> {
                    arr.add(null)
                }
            }
        }
        return arr
    }
}

/**
 * Parse JSON and restore buffer references
 * Corresponds to parseJsonAndRestoreBufferRefs in VSCode
 */
fun parseJsonAndRestoreBufferRefs(
    jsonString: String,
    buffers: List<ByteArray>,
    uriTransformer: ((String, Any?) -> Any?)? = null,
): Any {
    // In actual project, should implement more complete functionality
    // Need to parse JSON string, restore buffer references, and apply URI transformation
    return jsonString
}
