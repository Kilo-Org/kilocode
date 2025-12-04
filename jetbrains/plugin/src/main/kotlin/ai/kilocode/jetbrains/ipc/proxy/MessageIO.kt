// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.lang.Exception

// Symbol name for buffer reference during serialization
private const val REF_SYMBOL_NAME = "\$\$ref\$\$"

// Undefined reference
private val UNDEFINED_REF = mapOf(REF_SYMBOL_NAME to -1)

/**
 * JSON string with buffer references
 */
data class StringifiedJsonWithBufferRefs(
    val jsonString: String,
    val referencedBuffers: List<ByteArray>,
) {
    // data class auto-generates component1() and component2() functions, supports destructuring
}

/**
 * Serialize JSON to string with buffer references
 */
fun stringifyJsonWithBufferRefs(obj: Any?, replacer: ((String, Any?) -> Any?)? = null, useSafeStringify: Boolean = false): StringifiedJsonWithBufferRefs {
    val foundBuffers = mutableListOf<ByteArray>()

    // Process object recursively, identify and replace buffers
    fun processObject(value: Any?): Any? {
        return when (value) {
            null -> null
            is ByteArray -> {
                val bufferIndex = foundBuffers.size
                foundBuffers.add(value)
                mapOf(REF_SYMBOL_NAME to bufferIndex)
            }
            is Map<*, *> -> {
                val result = mutableMapOf<String, Any?>()
                value.forEach { (k, v) ->
                    val key = k.toString()
                    val processedValue = processObject(v)
                    val finalValue = replacer?.invoke(key, processedValue) ?: processedValue
                    result[key] = finalValue
                }
                result
            }
            is List<*> -> {
                value.map { processObject(it) }
            }
            is Array<*> -> {
                value.map { processObject(it) }
            }
            is SerializableObjectWithBuffers<*> -> {
                // Process serializable object
                processObject(value.value)
            }
            else -> {
                // If it is other basic types, return directly
                value
            }
        }
    }

    // Process object, collect buffers
    val processedObj = processObject(obj)

    // Use GSON for serialization
    val gson = Gson()
    val serialized = try {
        gson.toJson(processedObj)
    } catch (e: Exception) {
        if (useSafeStringify) "null" else throw e
    }

    return StringifiedJsonWithBufferRefs(serialized, foundBuffers)
}

/**
 * Request argument serialization type
 */
sealed class SerializedRequestArguments {
    /**
     * Simple type argument
     */
    data class Simple(val args: String) : SerializedRequestArguments() {
        override fun toString(): String {
            return args
        }
    }

    /**
     * Mixed type argument
     */
    data class Mixed(val args: List<MixedArg>) : SerializedRequestArguments() {
        override fun toString(): String {
            return args.joinToString { "\n" }
        }
    }
}

/**
 * Message IO utility class
 * Corresponds to MessageIO in VSCode
 */
object MessageIO {
    /**
     * Check whether to use mixed argument serialization
     */
    private fun useMixedArgSerialization(arr: List<Any?>): Boolean {
        for (arg in arr) {
            if (arg is ByteArray || arg is SerializableObjectWithBuffers<*> || arg == null) {
                return true
            }
        }
        return false
    }

    /**
     * Serialize request arguments
     */
    fun serializeRequestArguments(args: List<Any?>, replacer: ((String, Any?) -> Any?)? = null): SerializedRequestArguments {
        if (useMixedArgSerialization(args)) {
            val massagedArgs = mutableListOf<MixedArg>()
            for (i in args.indices) {
                val arg = args[i]
                when {
                    arg is ByteArray ->
                        massagedArgs.add(MixedArg.VSBufferArg(arg))
                    arg == null ->
                        massagedArgs.add(MixedArg.UndefinedArg)
                    arg is SerializableObjectWithBuffers<*> -> {
                        val result = stringifyJsonWithBufferRefs(arg.value, replacer)
                        massagedArgs.add(
                            MixedArg.SerializedObjectWithBuffersArg(
                                result.jsonString.toByteArray(),
                                result.referencedBuffers,
                            ),
                        )
                    }
                    else -> {
                        val gson = Gson()
                        massagedArgs.add(MixedArg.StringArg(gson.toJson(arg).toByteArray()))
                    }
                }
            }
            return SerializedRequestArguments.Mixed(massagedArgs)
        }

        val gson = Gson()
        return SerializedRequestArguments.Simple(gson.toJson(args))
    }

    /**
     * Serialize request
     */
    fun serializeRequest(
        req: Int,
        rpcId: Int,
        method: String,
        serializedArgs: SerializedRequestArguments,
        usesCancellationToken: Boolean,
    ): ByteArray {
        return when (serializedArgs) {
            is SerializedRequestArguments.Simple ->
                requestJSONArgs(req, rpcId, method, serializedArgs.args, usesCancellationToken)
            is SerializedRequestArguments.Mixed ->
                requestMixedArgs(req, rpcId, method, serializedArgs.args, usesCancellationToken)
        }
    }

    /**
     * Serialize JSON argument request
     */
    private fun requestJSONArgs(
        req: Int,
        rpcId: Int,
        method: String,
        args: String,
        usesCancellationToken: Boolean,
    ): ByteArray {
        val methodBuff = method.toByteArray()
        val argsBuff = args.toByteArray()

        var len = 0
        len += MessageBuffer.sizeUInt8 // use constant directly, not function call
        len += MessageBuffer.sizeShortString(methodBuff)
        len += MessageBuffer.sizeLongString(argsBuff)

        val messageType = if (usesCancellationToken) {
            MessageType.RequestJSONArgsWithCancellation
        } else {
            MessageType.RequestJSONArgs
        }

        val result = MessageBuffer.alloc(messageType, req, len)
        result.writeUInt8(rpcId)
        result.writeShortString(methodBuff)
        result.writeLongString(argsBuff)
        return result.bytes
    }

    /**
     * Deserialize JSON argument request
     */
    fun deserializeRequestJSONArgs(buff: MessageBuffer): Triple<Int, String, List<Any?>> {
        val rpcId = buff.readUInt8()
        var method = buff.readShortString()
        if (method.startsWith("\$")) {
            method = method.substring(1)
        }
        val argsJson = buff.readLongString()

        val gson = Gson()
        val listType = object : TypeToken<List<Any?>>() {}.type
        val args = gson.fromJson<List<Any?>>(argsJson, listType)

        return Triple(rpcId, method, args)
    }

    /**
     * Serialize mixed argument request
     */
    private fun requestMixedArgs(
        req: Int,
        rpcId: Int,
        method: String,
        args: List<MixedArg>,
        usesCancellationToken: Boolean,
    ): ByteArray {
        val methodBuff = method.toByteArray()

        var len = 0
        len += MessageBuffer.sizeUInt8 // use constant directly, not function call
        len += MessageBuffer.sizeShortString(methodBuff)
        len += MessageBuffer.sizeMixedArray(args)

        val messageType = if (usesCancellationToken) {
            MessageType.RequestMixedArgsWithCancellation
        } else {
            MessageType.RequestMixedArgs
        }

        val result = MessageBuffer.alloc(messageType, req, len)
        result.writeUInt8(rpcId)
        result.writeShortString(methodBuff)
        result.writeMixedArray(args)
        return result.bytes
    }

    /**
     * Deserialize mixed argument request
     */
    fun deserializeRequestMixedArgs(buff: MessageBuffer): Triple<Int, String, List<Any?>> {
        val rpcId = buff.readUInt8()
        var method = buff.readShortString()
        if (method.startsWith("\$")) {
            method = method.substring(1)
        }
        val rawArgs = buff.readMixedArray()
        val args = rawArgs.mapIndexed { _, rawArg ->
            when (rawArg) {
                is String -> {
                    val gson = Gson()
                    gson.fromJson(rawArg, Any::class.java)
                }
                else -> rawArg
            }
        }

        return Triple(rpcId, method, args)
    }

    /**
     * Serialize acknowledged message
     */
    fun serializeAcknowledged(req: Int): ByteArray {
        return MessageBuffer.alloc(MessageType.Acknowledged, req, 0).bytes
    }

    /**
     * Serialize cancel message
     */
    fun serializeCancel(req: Int): ByteArray {
        return MessageBuffer.alloc(MessageType.Cancel, req, 0).bytes
    }

    /**
     * Serialize OK reply
     */
    fun serializeReplyOK(req: Int, res: Any?, replacer: ((String, Any?) -> Any?)? = null): ByteArray {
        return when {
            res == null -> serializeReplyOKEmpty(req)
            res is ByteArray -> serializeReplyOKVSBuffer(req, res)
            res is SerializableObjectWithBuffers<*> -> {
                val result = stringifyJsonWithBufferRefs(res.value, replacer, true)
                serializeReplyOKJSONWithBuffers(req, result.jsonString, result.referencedBuffers)
            }
            else -> {
                val gson = Gson()
                val jsonStr = try {
                    gson.toJson(res)
                } catch (e: Exception) {
                    "null"
                }
                serializeReplyOKJSON(req, jsonStr)
            }
        }
    }

    /**
     * Serialize empty OK reply
     */
    private fun serializeReplyOKEmpty(req: Int): ByteArray {
        return MessageBuffer.alloc(MessageType.ReplyOKEmpty, req, 0).bytes
    }

    /**
     * Serialize OK reply with binary buffer
     */
    private fun serializeReplyOKVSBuffer(req: Int, res: ByteArray): ByteArray {
        var len = 0
        len += MessageBuffer.sizeVSBuffer(res)

        val result = MessageBuffer.alloc(MessageType.ReplyOKVSBuffer, req, len)
        result.writeVSBuffer(res)
        return result.bytes
    }

    /**
     * Deserialize OK reply with binary buffer
     */
    fun deserializeReplyOKVSBuffer(buff: MessageBuffer): ByteArray {
        return buff.readVSBuffer()
    }

    /**
     * Serialize OK reply with JSON
     */
    private fun serializeReplyOKJSON(req: Int, res: String): ByteArray {
        val resBuff = res.toByteArray()

        var len = 0
        len += MessageBuffer.sizeLongString(resBuff)

        val result = MessageBuffer.alloc(MessageType.ReplyOKJSON, req, len)
        result.writeLongString(resBuff)
        return result.bytes
    }

    /**
     * Serialize OK reply with JSON and buffers
     */
    private fun serializeReplyOKJSONWithBuffers(req: Int, res: String, buffers: List<ByteArray>): ByteArray {
        val resBuff = res.toByteArray()

        var len = 0
        len += MessageBuffer.sizeUInt32 // use constant directly, not function call
        len += MessageBuffer.sizeLongString(resBuff)
        for (buffer in buffers) {
            len += MessageBuffer.sizeVSBuffer(buffer)
        }

        val result = MessageBuffer.alloc(MessageType.ReplyOKJSONWithBuffers, req, len)
        result.writeUInt32(buffers.size)
        result.writeLongString(resBuff)
        for (buffer in buffers) {
            result.writeBuffer(buffer)
        }

        return result.bytes
    }

    /**
     * Deserialize OK reply with JSON
     */
    fun deserializeReplyOKJSON(buff: MessageBuffer): Any? {
        val res = buff.readLongString()
        val gson = Gson()
        return gson.fromJson(res, Any::class.java)
    }

    /**
     * Deserialize OK reply with JSON and buffers
     */
    fun deserializeReplyOKJSONWithBuffers(buff: MessageBuffer, uriTransformer: ((String, Any?) -> Any?)? = null): SerializableObjectWithBuffers<*> {
        val bufferCount = buff.readUInt32()
        val res = buff.readLongString()

        val buffers = mutableListOf<ByteArray>()
        for (i in 0 until bufferCount) {
            buffers.add(buff.readVSBuffer())
        }

        return SerializableObjectWithBuffers(parseJsonAndRestoreBufferRefs(res, buffers, uriTransformer))
    }

    /**
     * Serialize error reply
     */
    fun serializeReplyErr(req: Int, err: Throwable?): ByteArray {
        val errStr = if (err != null) {
            try {
                val gson = Gson()
                gson.toJson(transformErrorForSerialization(err))
            } catch (e: Exception) {
                null
            }
        } else {
            null
        }

        return if (errStr != null) {
            val errBuff = errStr.toByteArray()

            var len = 0
            len += MessageBuffer.sizeLongString(errBuff)

            val result = MessageBuffer.alloc(MessageType.ReplyErrError, req, len)
            result.writeLongString(errBuff)
            result.bytes
        } else {
            serializeReplyErrEmpty(req)
        }
    }

    /**
     * Deserialize error reply
     */
    fun deserializeReplyErrError(buff: MessageBuffer): Throwable {
        val err = buff.readLongString()
        val gson = Gson()
        val errorMap = gson.fromJson(err, Map::class.java)

        // Create custom exception
        val exception = Exception(errorMap["message"] as? String ?: "Unknown error")

        // Set stack and other properties
        if (errorMap.containsKey("stack")) {
            // Note: Java/Kotlin cannot directly set stack, this is just a demonstration
            // In actual implementation, may need custom exception type or other methods
        }

        return exception
    }

    /**
     * Serialize empty error reply
     */
    private fun serializeReplyErrEmpty(req: Int): ByteArray {
        return MessageBuffer.alloc(MessageType.ReplyErrEmpty, req, 0).bytes
    }

    /**
     * Transform error for serialization
     */
    private fun transformErrorForSerialization(error: Throwable): Map<String, Any?> {
        return mapOf(
            "\$isError" to true,
            "name" to error.javaClass.simpleName,
            "message" to error.message,
            "stack" to error.stackTraceToString(),
        )
    }
}
