package com.ly.creatoros.secure_attachment_storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Single native source of truth for the encrypted share queue.
 *
 * Foreground Flutter, headless WorkManager and native import services all use
 * this class so an append cannot race an acknowledgement in another engine.
 * Durable job manifests are recovered before every read, which also closes the
 * process-kill window between encrypting an attachment and publishing its row.
 */
class ShareQueueBridge(private val context: Context) {
    companion object {
        private const val preferencesName = "ly_share_intake"
        private const val pendingKey = "pending_shares_v1"
        private const val completedJobsKey = "completed_import_jobs_v1"
        private const val alias = "ly_creator_share_queue_v1"
        private const val prefix = "enc:v1:"
        private val safeShareId = Regex("""[A-Za-z0-9._-]{1,128}""")
        private val lock = Any()
    }

    fun listPending(): List<Map<String, Any?>> = synchronized(lock) {
        recoverDurableJobsLocked()
        listPendingLocked()
    }

    fun findPending(shareId: String): Map<String, Any?>? = synchronized(lock) {
        recoverDurableJobsLocked()
        listPendingLocked().firstOrNull { it["shareId"] == shareId }
    }

    fun acknowledge(shareId: String) = synchronized(lock) {
        val remaining = listPendingLocked().filter { it["shareId"] != shareId }
        writePendingLocked(remaining)
    }

    fun isCompleted(shareId: String): Boolean = synchronized(lock) {
        val marker = completedJobFile(shareId)
        if (marker.exists()) return@synchronized true
        if (completedJobsLocked().contains(shareId)) {
            markCompletedLocked(shareId)
            return@synchronized true
        }
        false
    }

    fun writeDurableJob(
        shareId: String,
        value: Map<String, Any?>,
        cleanupPaths: List<String>,
    ) = synchronized(lock) {
        require(safeShareId.matches(shareId)) { "安全导入标识无效" }
        val target = durableJobFile(shareId)
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, ".${target.name}.partial")
        val wrapper = linkedMapOf<String, Any?>(
            "value" to value,
            "cleanupPaths" to cleanupPaths,
        )
        val encrypted = encrypt(mapToJsonObject(wrapper).toString())
        try {
            FileOutputStream(temporary).use { output ->
                output.write(encrypted.toByteArray(StandardCharsets.UTF_8))
                output.fd.sync()
            }
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } finally {
            temporary.delete()
        }
    }

    fun resumeDurableJob(shareId: String): Map<String, Any?>? =
        synchronized(lock) {
            val job = loadDurableJobLocked(shareId) ?: return@synchronized null
            publishDurableJobLocked(shareId, job.first, job.second)
            job.first
        }

    fun publishDurableJob(
        shareId: String,
        value: Map<String, Any?>,
        cleanupPaths: List<String>,
    ) = synchronized(lock) {
        publishDurableJobLocked(shareId, value, cleanupPaths)
    }

    private fun publishDurableJobLocked(
        shareId: String,
        value: Map<String, Any?>,
        cleanupPaths: List<String>,
    ) {
        // The encrypted attachment and fsynced manifest already exist. Remove
        // every temporary clear copy before making the queue visible so a crash
        // cannot leave plaintext behind after headless Dart acknowledges it.
        for (path in cleanupPaths) {
            val clearFile = File(path)
            if (clearFile.exists() && !clearFile.delete()) {
                throw IllegalStateException("附件明文副本清理失败")
            }
        }
        appendPendingLocked(value)
        markCompletedLocked(shareId)
        durableJobFile(shareId).delete()
    }

    private fun recoverDurableJobsLocked() {
        val directory = File(context.filesDir, "mobile-import-jobs")
        val jobs = directory.listFiles { file ->
            file.isFile && file.name.endsWith(".job")
        }.orEmpty().sortedBy { it.name }
        for (file in jobs) {
            val shareId = file.name.removeSuffix(".job")
            if (!safeShareId.matches(shareId)) continue
            val job = loadDurableJobLocked(shareId)
                ?: throw IllegalStateException("安全导入恢复信息损坏")
            publishDurableJobLocked(shareId, job.first, job.second)
        }
    }

    private fun loadDurableJobLocked(
        shareId: String,
    ): Pair<Map<String, Any?>, List<String>>? {
        val file = durableJobFile(shareId)
        if (!file.exists()) return null
        val raw = decrypt(file.readText())
        val wrapper = jsonObjectToMap(JSONObject(raw))
        val value = (wrapper["value"] as? Map<*, *>)
            ?.entries
            ?.associate { it.key.toString() to it.value }
            ?: throw IllegalStateException("安全导入恢复内容无效")
        val cleanupPaths = (wrapper["cleanupPaths"] as? List<*>)
            .orEmpty()
            .filterIsInstance<String>()
        return value to cleanupPaths
    }

    private fun durableJobFile(shareId: String): File =
        File(context.filesDir, "mobile-import-jobs/$shareId.job")

    private fun appendPendingLocked(value: Map<String, Any?>) {
        val shareId = value["shareId"]
        val current = listPendingLocked()
        if (current.any { it["shareId"] == shareId }) return
        writePendingLocked(current + value)
    }

    private fun listPendingLocked(): List<Map<String, Any?>> {
        val stored = context.getSharedPreferences(
            preferencesName,
            Context.MODE_PRIVATE,
        ).getString(pendingKey, "[]") ?: "[]"
        val array = JSONArray(decrypt(stored))
        return (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let(::jsonObjectToMap)
        }
    }

    private fun writePendingLocked(values: List<Map<String, Any?>>) {
        val encoded = encrypt(
            JSONArray(values.map(::mapToJsonObject)).toString(),
        )
        val saved = context.getSharedPreferences(
            preferencesName,
            Context.MODE_PRIVATE,
        ).edit().putString(pendingKey, encoded).commit()
        if (!saved) throw IllegalStateException("离线分享队列保存失败")
    }

    private fun completedJobsLocked(): Set<String> =
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .getStringSet(completedJobsKey, emptySet())
            .orEmpty()

    private fun markCompletedLocked(shareId: String) {
        val target = completedJobFile(shareId)
        if (target.exists()) return
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, ".${target.name}.partial")
        try {
            FileOutputStream(temporary).use { output ->
                output.write(byteArrayOf(1))
                output.fd.sync()
            }
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } finally {
            temporary.delete()
        }
    }

    private fun completedJobFile(shareId: String): File {
        require(safeShareId.matches(shareId)) { "安全导入标识无效" }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(shareId.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return File(context.filesDir, "mobile-import-completed/$digest.done")
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return prefix + Base64.encodeToString(
            cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    }

    private fun decrypt(value: String): String {
        if (!value.startsWith(prefix)) return value
        val combined = Base64.decode(value.removePrefix(prefix), Base64.NO_WRAP)
        require(combined.size > 28) { "离线分享队列密文无效" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, combined.copyOfRange(0, 12)),
        )
        return cipher.doFinal(
            combined.copyOfRange(12, combined.size),
        ).toString(Charsets.UTF_8)
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun mapToJsonObject(value: Map<String, Any?>): JSONObject {
        val result = JSONObject()
        value.forEach { (key, item) ->
            result.put(
                key,
                when (item) {
                    is Map<*, *> -> mapToJsonObject(
                        item.entries.associate { it.key.toString() to it.value },
                    )
                    is List<*> -> JSONArray(
                        item.map { child ->
                            if (child is Map<*, *>) {
                                mapToJsonObject(
                                    child.entries.associate {
                                        it.key.toString() to it.value
                                    },
                                )
                            } else {
                                child
                            }
                        },
                    )
                    else -> item
                },
            )
        }
        return result
    }

    private fun jsonObjectToMap(value: JSONObject): Map<String, Any?> {
        val result = linkedMapOf<String, Any?>()
        value.keys().forEach { key ->
            result[key] = when (val item = value.opt(key)) {
                is JSONObject -> jsonObjectToMap(item)
                is JSONArray -> (0 until item.length()).map { index ->
                    when (val child = item.opt(index)) {
                        is JSONObject -> jsonObjectToMap(child)
                        JSONObject.NULL -> null
                        else -> child
                    }
                }
                JSONObject.NULL -> null
                else -> item
            }
        }
        return result
    }
}
