// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import kotlin.reflect.KFunction
import kotlin.reflect.full.callSuspend
import kotlin.reflect.full.isSubtypeOf
import kotlin.reflect.typeOf

suspend fun doInvokeMethod(
    method: KFunction<*>,
    args: List<Any?>,
    actor: Any,
): Any? {
    // Handle parameters
    val parameterTypes = method.parameters
    val processedArgs = ArrayList<Any?>(parameterTypes.size)
    val realArgs = listOf(actor, *args.toTypedArray())
    // Handle parameter type mismatch and nullable parameter issues
    for (i in parameterTypes.indices) {
        if (i < realArgs.size) {
            // Argument is provided, handle type conversion
            val arg = realArgs[i]
            val paramType = parameterTypes[i]

            // Handle type mismatch caused by serialization (e.g., int serialized as double or string)
            val convertedArg = when {
                // Handle String to Int conversion
                arg is String && (
                    paramType.type.isSubtypeOf(typeOf<Int>()) ||
                        paramType.type.isSubtypeOf(typeOf<Int?>())
                    ) -> {
                    try {
                        arg.toInt()
                    } catch (e: NumberFormatException) {
                        arg
                    }
                }

                // Handle String to Long conversion
                arg is String && (
                    paramType.type.isSubtypeOf(typeOf<Long>()) ||
                        paramType.type.isSubtypeOf(typeOf<Long?>())
                    ) -> {
                    try {
                        arg.toLong()
                    } catch (e: NumberFormatException) {
                        arg
                    }
                }

                // Handle String to Double conversion
                arg is String && (
                    paramType.type.isSubtypeOf(typeOf<Double>()) ||
                        paramType.type.isSubtypeOf(typeOf<Double?>())
                    ) -> {
                    try {
                        arg.toDouble()
                    } catch (e: NumberFormatException) {
                        arg
                    }
                }

                // Handle String to Float conversion
                arg is String && (
                    paramType.type.isSubtypeOf(typeOf<Float>()) ||
                        paramType.type.isSubtypeOf(typeOf<Float?>())
                    ) -> {
                    try {
                        arg.toFloat()
                    } catch (e: NumberFormatException) {
                        arg
                    }
                }

                // Handle String to Boolean conversion
                arg is String && (
                    paramType.type.isSubtypeOf(typeOf<Boolean>()) ||
                        paramType.type.isSubtypeOf(typeOf<Boolean?>())
                    ) -> {
                    arg.toBoolean()
                }

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Int>()) ||
                        paramType.type.isSubtypeOf(typeOf<Int?>())
                    ) ->
                    arg.toInt()

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Long>()) ||
                        paramType.type.isSubtypeOf(typeOf<Long?>())
                    ) ->
                    arg.toLong()

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Float>()) ||
                        paramType.type.isSubtypeOf(typeOf<Float?>())
                    ) ->
                    arg.toFloat()

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Short>()) ||
                        paramType.type.isSubtypeOf(typeOf<Short?>())
                    ) ->
                    arg.toInt().toShort()

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Byte>()) ||
                        paramType.type.isSubtypeOf(typeOf<Byte?>())
                    ) ->
                    arg.toInt().toByte()

                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Boolean>()) ||
                        paramType.type.isSubtypeOf(typeOf<Boolean?>())
                    ) ->
                    arg != 0.0

                // Handle Double to Double? - keep as Double (no conversion needed)
                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Double>()) ||
                        paramType.type.isSubtypeOf(typeOf<Double?>())
                    ) ->
                    arg

                // Handle Double to Any? conversion - convert to appropriate numeric type
                arg is Double && (
                    paramType.type.isSubtypeOf(typeOf<Any?>()) ||
                        paramType.type.isSubtypeOf(typeOf<Any>())
                    ) -> {
                    // If the double is a whole number, convert to Int, otherwise keep as Double
                    if (arg % 1.0 == 0.0 && arg >= Int.MIN_VALUE && arg <= Int.MAX_VALUE) {
                        arg.toInt()
                    } else {
                        arg
                    }
                }

                else -> arg
            }

            processedArgs.add(convertedArg)
        } else {
            // Argument missing, check if it is a primitive type and set appropriate default value
            val paramType = parameterTypes[i]

            // Special handling for String type: set to empty string instead of null
            if (paramType == String::class.java) {
                processedArgs.add("")
            } else {
                processedArgs.add(null)
            }
        }
    }

    // Invoke method
    return method.callSuspend(*processedArgs.toTypedArray())
}
