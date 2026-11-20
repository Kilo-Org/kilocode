package ai.kilocode.client.agentManager.hosted

import java.security.SecureRandom

private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
private const val LENGTH = 14
private val random = SecureRandom()

/**
 * Cloud message IDs are `msg_`, a 12-character lowercase hex timestamp, then 14
 * base62 characters. Cloud rejects any other shape before processing the request.
 */
internal fun hostedMessageID(now: Long = System.currentTimeMillis()): String {
    val prefix = now.toString(16).padStart(12, '0').takeLast(12)
    val suffix = buildString { repeat(LENGTH) { append(ALPHABET[random.nextInt(ALPHABET.length)]) } }
    return "msg_$prefix$suffix"
}
