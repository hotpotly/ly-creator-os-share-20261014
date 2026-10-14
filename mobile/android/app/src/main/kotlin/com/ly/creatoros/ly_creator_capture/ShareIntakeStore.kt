package com.ly.creatoros.ly_creator_capture

import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import com.ly.creatoros.secure_attachment_storage.EncryptedAttachmentStore
import com.ly.creatoros.secure_attachment_storage.SecureValueStore
import com.ly.creatoros.secure_attachment_storage.ShareQueueBridge
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class ShareIntakeStore(private val context: Context) {
    companion object {
        private val importLock = Any()

        fun cleanupAbandonedPlaintext(context: Context) =
            synchronized(importLock) {
                File(context.filesDir, "mobile-attachment-intake")
                    .listFiles()
                    .orEmpty()
                    .filter(File::isDirectory)
                    .flatMap { it.listFiles().orEmpty().toList() }
                    .filter { !it.name.endsWith(".lyenc") }
                    .forEach(File::delete)
            }
    }

    data class Result(val value: Map<String, Any?>?, val error: String?)
    private data class EncryptedPreview(val id: String, val path: String)
    private data class AttachmentCheckpoint(
        val position: Int,
        val sourceKey: String,
        val value: Map<String, Any?>,
    )
    data class EncryptedPrivateFile(
        val attachmentId: String,
        val file: File,
        val name: String,
        val mimeType: String,
        val clearSize: Long,
        val sha256: String,
        val sourceModifiedAtMillis: Long? = null,
    )
    private val queue = ShareQueueBridge(context)

    fun captureEncryptedFiles(
        files: List<EncryptedPrivateFile>,
        sourceApp: String,
        recordingMarkersMs: List<Long>,
        recordingInterruptionReason: String?,
        shareId: String,
    ): Result {
        return try {
            queue.resumeDurableJob(shareId)?.let { return Result(it, null) }
            queue.findPending(shareId)?.let { return Result(it, null) }
            if (queue.isCompleted(shareId)) {
                return Result(mapOf("shareId" to shareId), null)
            }
            if (files.isEmpty()) throw IllegalArgumentException("录音没有可保存的片段")
            val encryptedStore = EncryptedAttachmentStore(context)
            // Callers provide the user-visible order. Do not reconstruct it
            // from filenames: long segmented recordings can exceed any
            // filename padding width.
            val attachments = files.map { item ->
                if (!item.file.exists() ||
                    encryptedStore.clearSize(item.file) != item.clearSize ||
                    !item.sha256.matches(Regex("""[0-9a-f]{64}"""))
                ) {
                    throw IllegalStateException("录音加密片段校验失败")
                }
                linkedMapOf<String, Any?>(
                    "attachmentId" to item.attachmentId,
                    "localPath" to item.file.absolutePath,
                    "name" to safeName(item.name),
                    "mimeType" to item.mimeType,
                    "sizeBytes" to item.clearSize,
                    "sha256" to item.sha256,
                    "encryptedAtRest" to true,
                    "sourceModifiedAt" to item.sourceModifiedAtMillis
                        ?.takeIf { it > 0L }
                        ?.let(::utcAt),
                )
            }
            val value = linkedMapOf<String, Any?>(
                "shareId" to shareId,
                "content" to "",
                "createdAt" to utcNow(),
                "sourceApp" to sourceApp,
                "recordingMarkersMs" to recordingMarkersMs,
                "recordingInterruptionReason" to recordingInterruptionReason,
                "attachments" to attachments,
            )
            queue.writeDurableJob(shareId, value, emptyList())
            queue.publishDurableJob(shareId, value, emptyList())
            Result(value, null)
        } catch (error: Exception) {
            Result(null, error.message ?: "录音安全保存失败")
        }
    }

    fun capturePrivateFile(
        file: File,
        name: String,
        mimeType: String,
        persist: Boolean,
        sourceApp: String,
        recordingMarkersMs: List<Long> = emptyList(),
        recordingInterruptionReason: String? = null,
        shareId: String? = null,
    ): Result {
        val stableShareId = shareId
            ?.takeIf { it.matches(Regex("""[A-Za-z0-9._-]{1,128}""")) }
            ?: UUID.randomUUID().toString()
        return try {
            if (persist) {
                queue.resumeDurableJob(stableShareId)
                    ?.let { return Result(it, null) }
                queue.findPending(stableShareId)
                    ?.let { return Result(it, null) }
                if (queue.isCompleted(stableShareId)) {
                    return Result(mapOf("shareId" to stableShareId), null)
                }
            }
            if (!file.exists() || file.length() <= 0L) {
                throw IllegalArgumentException("私有文件不存在或为空")
            }
            val effectiveMime = effectiveMediaMime(file, name, mimeType)
            val sourceModifiedAt = file.lastModified().takeIf { it > 0L }
            val sanitized = MediaPrivacySanitizer.sanitize(file, effectiveMime)
            val attachmentId = stableAttachmentId(stableShareId, 0)
            val encryptedStore = EncryptedAttachmentStore(context)
            val preview = createEncryptedPreview(
                file,
                sanitized.mimeType,
                attachmentId,
                encryptedStore,
            )
            val storedSha256 = sha256(file)
            val encrypted = encryptedStore.encrypt(
                file,
                attachmentId,
                deleteSource = true,
            )
            val value = linkedMapOf<String, Any?>(
                "shareId" to stableShareId,
                "content" to "",
                "createdAt" to utcNow(),
                "sourceApp" to sourceApp,
                "recordingMarkersMs" to recordingMarkersMs,
                "recordingInterruptionReason" to recordingInterruptionReason,
                "attachments" to listOf(
                    linkedMapOf<String, Any?>(
                        "attachmentId" to attachmentId,
                        "localPath" to encrypted.file.absolutePath,
                        "name" to sanitizedName(safeName(name), sanitized),
                        "mimeType" to sanitized.mimeType,
                        "sizeBytes" to encrypted.clearSize,
                        "sha256" to storedSha256,
                        "encryptedAtRest" to true,
                        "previewAttachmentId" to preview?.id,
                        "previewLocalPath" to preview?.path,
                        "sourceModifiedAt" to (
                            sanitized.captureTimeMillis ?: sourceModifiedAt
                            )?.let(::utcAt),
                    ),
                ),
            )
            if (persist) {
                queue.writeDurableJob(stableShareId, value, emptyList())
                queue.publishDurableJob(stableShareId, value, emptyList())
                Result(value, null)
            } else {
                Result(value, null)
            }
        } catch (error: Exception) {
            Result(null, error.message ?: "私有文件保存失败")
        }
    }

    fun captureIntent(
        intent: Intent,
        persist: Boolean,
        sourceApp: String? = null,
        shareId: String? = null,
        onProgress: ((copiedBytes: Long, totalBytes: Long?) -> Unit)? = null,
        onStage: ((String) -> Unit)? = null,
    ): Result = synchronized(importLock) {
        captureIntentLocked(
            intent = intent,
            persist = persist,
            sourceApp = sourceApp,
            shareId = shareId,
            onProgress = onProgress,
            onStage = onStage,
        )
    }

    private fun captureIntentLocked(
        intent: Intent,
        persist: Boolean,
        sourceApp: String? = null,
        shareId: String? = null,
        onProgress: ((copiedBytes: Long, totalBytes: Long?) -> Unit)? = null,
        onStage: ((String) -> Unit)? = null,
    ): Result {
        val stableShareId = shareId
            ?.takeIf { it.matches(Regex("""[A-Za-z0-9._-]{1,128}""")) }
            ?: UUID.randomUUID().toString()
        val targetDirectory = File(context.filesDir, "mobile-attachment-intake/$stableShareId")
        val completedMarker = File(targetDirectory, ".import-complete")
        val sharedAt = intent.getLongExtra(
            ImportService.extraSharedAtMillis,
            0L,
        ).takeIf { it > 0L }?.let(::utcAt) ?: utcNow()
        if (persist) {
            queue.resumeDurableJob(stableShareId)
                ?.let { return Result(it, null) }
        }
        val existing = queue.findPending(stableShareId)
        if (existing != null) {
            return Result(existing, null)
        }
        if (completedMarker.exists() || queue.isCompleted(stableShareId)) {
            return Result(mapOf("shareId" to stableShareId), null)
        }
        return try {
            val uris = collectUris(intent)
            val originalText =
                (intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: "")
                    .trim()
            val oversizedTextBytes = originalText
                .takeIf { it.length > 100_000 }
                ?.toByteArray(StandardCharsets.UTF_8)
            val text = if (oversizedTextBytes == null) {
                originalText
            } else {
                "${originalText.take(99_940)}\n\n【分享全文已安全保存为附件】"
            }
            val sourceTitle = intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString()?.trim()?.take(500)?.takeIf { it.isNotEmpty() }
            val sourceUrl = Regex("""https?://[^\s]+""", RegexOption.IGNORE_CASE)
                .find(originalText)?.value?.trimEnd('.', ',', '，', '。', ')', '）')
            if (uris.isEmpty() && text.isEmpty()) throw IllegalArgumentException("分享内容为空")
            val totalBytes: Long? = null
            val checkpoints = loadAttachmentCheckpoints(
                targetDirectory,
                stableShareId,
            ).toMutableList()
            var allCopiedBytes = checkpoints.sumOf {
                (it.value["sizeBytes"] as? Number)?.toLong() ?: 0L
            }
            var lastProgressBytes = -1L
            fun reportProgress(force: Boolean = false) {
                if (force || allCopiedBytes - lastProgressBytes >= 4L * 1024 * 1024) {
                    lastProgressBytes = allCopiedBytes
                    onProgress?.invoke(allCopiedBytes, totalBytes)
                }
            }
            reportProgress(force = true)
            targetDirectory.mkdirs()
            targetDirectory.setReadable(false, false)
            targetDirectory.setReadable(true, true)
            targetDirectory.setWritable(false, false)
            targetDirectory.setWritable(true, true)
            val encryptedStore = EncryptedAttachmentStore(context)
            val attachments = uris.mapIndexed { index, uri ->
                val attachmentId = stableAttachmentId(stableShareId, index)
                val sourceKey = sourceKey(uri)
                checkpoints.firstOrNull {
                    it.position == index &&
                        it.sourceKey == sourceKey &&
                        checkpointIsUsable(
                            it.value,
                            attachmentId,
                            targetDirectory,
                            encryptedStore,
                        )
                }?.value ?: run {
                    val metadata = queryMetadata(uri)
                    val result = context.contentResolver
                        .openInputStream(uri).use { raw ->
                            if (raw == null) {
                                throw IllegalArgumentException("无法读取分享的文件")
                            }
                            BufferedInputStream(raw, 1024 * 1024).use { input ->
                                input.mark(128)
                                val header = ByteArray(64)
                                val headerSize = input.read(header)
                                    .coerceAtLeast(0)
                                input.reset()
                                val preliminaryMime = sniffedMediaMime(
                                    header,
                                    headerSize,
                                    metadata.name,
                                    metadata.mimeType,
                                )
                                if (
                                    preliminaryMime.startsWith("image/") ||
                                    preliminaryMime.startsWith("video/")
                                ) {
                                    captureMediaAttachment(
                                        input = input,
                                        metadata = metadata,
                                        detectedMime = preliminaryMime,
                                        attachmentId = attachmentId,
                                        targetDirectory = targetDirectory,
                                        encryptedStore = encryptedStore,
                                        onCopied = { copied ->
                                            allCopiedBytes += copied
                                            reportProgress()
                                        },
                                        onStage = onStage,
                                    )
                                } else {
                                    captureStreamAttachment(
                                        input = input,
                                        metadata = metadata,
                                        attachmentId = attachmentId,
                                        targetDirectory = targetDirectory,
                                        encryptedStore = encryptedStore,
                                        onCopied = { delta ->
                                            allCopiedBytes += delta
                                            reportProgress()
                                        },
                                        onStage = onStage,
                                    )
                                }
                            }
                        }
                    checkpoints.removeAll { it.position == index }
                    checkpoints += AttachmentCheckpoint(
                        index,
                        sourceKey,
                        result,
                    )
                    saveAttachmentCheckpoints(
                        targetDirectory,
                        stableShareId,
                        checkpoints,
                    )
                    result
                }
            }.toMutableList()
            if (oversizedTextBytes != null) {
                val index = uris.size
                val attachmentId = stableAttachmentId(stableShareId, index)
                val textDigest = MessageDigest.getInstance("SHA-256")
                    .digest(oversizedTextBytes)
                    .joinToString("") { "%02x".format(it) }
                val checkpointSourceKey = "shared-text:$textDigest"
                val textAttachment = checkpoints.firstOrNull {
                    it.position == index &&
                        it.sourceKey == checkpointSourceKey &&
                        checkpointIsUsable(
                            it.value,
                            attachmentId,
                            targetDirectory,
                            encryptedStore,
                        )
                }?.value ?: captureStreamAttachment(
                    input = BufferedInputStream(
                        ByteArrayInputStream(oversizedTextBytes),
                    ),
                    metadata = Metadata(
                        name = "分享全文.txt",
                        mimeType = "text/plain",
                        declaredSize = oversizedTextBytes.size.toLong(),
                        capturedAtMillis = null,
                        modifiedAtMillis = null,
                    ),
                    attachmentId = attachmentId,
                    targetDirectory = targetDirectory,
                    encryptedStore = encryptedStore,
                    onCopied = { delta ->
                        allCopiedBytes += delta
                        reportProgress()
                    },
                    onStage = onStage,
                ).also { result ->
                    checkpoints.removeAll { it.position == index }
                    checkpoints += AttachmentCheckpoint(
                        index,
                        checkpointSourceKey,
                        result,
                    )
                    saveAttachmentCheckpoints(
                        targetDirectory,
                        stableShareId,
                        checkpoints,
                    )
                }
                attachments += textAttachment
            }
            reportProgress(force = true)
            val value = linkedMapOf<String, Any?>(
                "shareId" to stableShareId,
                "content" to text,
                "createdAt" to sharedAt,
                "sourceApp" to sourceApp?.trim()?.take(255)?.takeIf { it.isNotEmpty() },
                "sourceTitle" to sourceTitle,
                "sourceUrl" to sourceUrl,
                "attachments" to attachments,
            )
            if (persist) {
                queue.writeDurableJob(stableShareId, value, emptyList())
                queue.publishDurableJob(stableShareId, value, emptyList())
                attachmentCheckpointFile(targetDirectory).delete()
                completedMarker.writeText(stableShareId)
                return Result(value, null)
            }
            Result(value, null)
        } catch (error: Exception) {
            if (!persist) {
                targetDirectory.deleteRecursively()
            } else {
                // Keep completed ciphertext candidates for a redelivered
                // intent, but never leave a clear/partial staging file after
                // a handled failure.
                targetDirectory.listFiles().orEmpty()
                    .filter { !it.name.endsWith(".lyenc") }
                    .forEach(File::delete)
            }
            Result(null, error.message ?: "分享内容保存失败")
        }
    }

    fun listPending(): List<Map<String, Any?>> = queue.listPending()

    fun acknowledge(shareId: String) = queue.acknowledge(shareId)

    fun discardIncompleteImport(shareId: String) {
        synchronized(importLock) {
            if (!shareId.matches(Regex("""[A-Za-z0-9._-]{1,128}"""))) {
                return@synchronized
            }
            if (
                queue.isCompleted(shareId) ||
                queue.findPending(shareId) != null
            ) {
                return@synchronized
            }
            File(
                context.filesDir,
                "mobile-attachment-intake/$shareId",
            ).deleteRecursively()
        }
    }

    private fun stableAttachmentId(shareId: String, index: Int): String =
        UUID.nameUUIDFromBytes(
            "ly-creator-attachment-v1:$shareId:$index".toByteArray(
                StandardCharsets.UTF_8,
            ),
        ).toString()

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun captureMediaAttachment(
        input: BufferedInputStream,
        metadata: Metadata,
        detectedMime: String,
        attachmentId: String,
        targetDirectory: File,
        encryptedStore: EncryptedAttachmentStore,
        onCopied: (Long) -> Unit,
        onStage: ((String) -> Unit)?,
    ): Map<String, Any?> {
        onStage?.invoke("正在安全复制媒体…")
        val destination = File(targetDirectory, attachmentId)
        val temporary = File(targetDirectory, ".${destination.name}.partial")
        destination.delete()
        temporary.delete()
        var copiedBytes = 0L
        FileOutputStream(temporary).use { output ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count == 0) continue
                copiedBytes += count
                onCopied(count.toLong())
                output.write(buffer, 0, count)
            }
            output.fd.sync()
        }
        if (copiedBytes <= 0L) throw IllegalArgumentException("不支持空文件")
        Files.move(
            temporary.toPath(),
            destination.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
        metadata.modifiedAtMillis
            ?.takeIf { it > 0L }
            ?.let(destination::setLastModified)
        onStage?.invoke("正在清理媒体隐私信息…")
        val sanitized = MediaPrivacySanitizer.sanitize(
            destination,
            detectedMime,
        )
        val sourceModifiedAt = sanitized.captureTimeMillis
            ?: metadata.capturedAtMillis
            ?: metadata.modifiedAtMillis
        val preview = createEncryptedPreview(
            destination,
            sanitized.mimeType,
            attachmentId,
            encryptedStore,
        )
        val storedSha256 = sha256(destination)
        onStage?.invoke("正在加密保存媒体…")
        val encrypted = encryptedStore.encrypt(
            destination,
            attachmentId,
            deleteSource = true,
        )
        return linkedMapOf(
            "attachmentId" to attachmentId,
            "localPath" to encrypted.file.absolutePath,
            "name" to sanitizedName(metadata.name, sanitized),
            "mimeType" to sanitized.mimeType,
            "sizeBytes" to encrypted.clearSize,
            "sha256" to storedSha256,
            "encryptedAtRest" to true,
            "previewAttachmentId" to preview?.id,
            "previewLocalPath" to preview?.path,
            "sourceModifiedAt" to sourceModifiedAt?.let(::utcAt),
        )
    }

    private fun captureStreamAttachment(
        input: BufferedInputStream,
        metadata: Metadata,
        attachmentId: String,
        targetDirectory: File,
        encryptedStore: EncryptedAttachmentStore,
        onCopied: (Long) -> Unit,
        onStage: ((String) -> Unit)?,
    ): Map<String, Any?> {
        onStage?.invoke("正在加密保存文件…")
        var copied = 0L
        val encrypted = encryptedStore.encryptStream(
            input,
            targetDirectory,
            attachmentId,
        ) { total ->
            val delta = total - copied
            copied = total
            onCopied(delta)
        }
        return linkedMapOf(
            "attachmentId" to attachmentId,
            "localPath" to encrypted.file.absolutePath,
            "name" to metadata.name,
            "mimeType" to metadata.mimeType,
            "sizeBytes" to encrypted.clearSize,
            "sha256" to encrypted.sha256,
            "encryptedAtRest" to true,
            "sourceModifiedAt" to metadata.modifiedAtMillis
                ?.takeIf { it > 0L }
                ?.let(::utcAt),
        )
    }

    private fun sourceKey(uri: Uri): String =
        MessageDigest.getInstance("SHA-256")
            .digest(uri.toString().toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun attachmentCheckpointFile(directory: File): File =
        File(directory, ".attachment-checkpoint.lyenc")

    private fun saveAttachmentCheckpoints(
        directory: File,
        shareId: String,
        checkpoints: List<AttachmentCheckpoint>,
    ) {
        val target = attachmentCheckpointFile(directory)
        val temporary = File(directory, ".attachment-checkpoint.partial")
        val payload = JSONObject().apply {
            put("shareId", shareId)
            put(
                "attachments",
                JSONArray(
                    checkpoints.sortedBy { it.position }.map { checkpoint ->
                        val value = checkpoint.value
                        JSONObject().apply {
                            put("position", checkpoint.position)
                            put("sourceKey", checkpoint.sourceKey)
                            for (
                                key in listOf(
                                    "attachmentId",
                                    "localPath",
                                    "name",
                                    "mimeType",
                                    "sizeBytes",
                                    "sha256",
                                    "encryptedAtRest",
                                    "previewAttachmentId",
                                    "previewLocalPath",
                                    "sourceModifiedAt",
                                )
                            ) {
                                put(key, value[key] ?: JSONObject.NULL)
                            }
                        }
                    },
                ),
            )
        }
        val encrypted = SecureValueStore().encrypt(payload.toString())
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

    private fun loadAttachmentCheckpoints(
        directory: File,
        shareId: String,
    ): List<AttachmentCheckpoint> {
        val file = attachmentCheckpointFile(directory)
        if (!file.exists()) return emptyList()
        return runCatching {
            val payload = JSONObject(
                SecureValueStore().decrypt(file.readText()),
            )
            if (payload.getString("shareId") != shareId) {
                throw IllegalStateException("附件恢复标识不一致")
            }
            val array = payload.optJSONArray("attachments") ?: JSONArray()
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                fun optional(key: String): String? =
                    if (item.isNull(key)) null else item.optString(key)
                        .takeIf { it.isNotEmpty() }
                AttachmentCheckpoint(
                    position = item.getInt("position"),
                    sourceKey = item.getString("sourceKey"),
                    value = linkedMapOf(
                        "attachmentId" to item.getString("attachmentId"),
                        "localPath" to item.getString("localPath"),
                        "name" to item.getString("name"),
                        "mimeType" to item.getString("mimeType"),
                        "sizeBytes" to item.getLong("sizeBytes"),
                        "sha256" to item.getString("sha256"),
                        "encryptedAtRest" to item.optBoolean(
                            "encryptedAtRest",
                            true,
                        ),
                        "previewAttachmentId" to optional(
                            "previewAttachmentId",
                        ),
                        "previewLocalPath" to optional("previewLocalPath"),
                        "sourceModifiedAt" to optional("sourceModifiedAt"),
                    ),
                )
            }
        }.getOrElse {
            file.delete()
            emptyList()
        }
    }

    private fun checkpointIsUsable(
        value: Map<String, Any?>,
        expectedAttachmentId: String,
        directory: File,
        store: EncryptedAttachmentStore,
    ): Boolean = runCatching {
        if (value["attachmentId"] != expectedAttachmentId) return false
        val path = value["localPath"] as? String ?: return false
        val file = File(path).canonicalFile
        val root = directory.canonicalFile
        if (
            !file.path.startsWith("${root.path}${File.separator}") ||
            !file.name.endsWith(".lyenc") ||
            !file.isFile
        ) {
            return false
        }
        val size = (value["sizeBytes"] as? Number)?.toLong() ?: return false
        val digest = value["sha256"] as? String ?: return false
        size > 0L &&
            digest.matches(Regex("""[0-9a-f]{64}""")) &&
            store.clearSize(file) == size
    }.getOrDefault(false)

    private fun sniffedMediaMime(
        header: ByteArray,
        count: Int,
        name: String,
        declaredMime: String,
    ): String {
        fun starts(vararg bytes: Int): Boolean =
            count >= bytes.size &&
                bytes.indices.all {
                    header[it].toInt() and 0xff == bytes[it]
                }
        if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"
        if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
            return "image/png"
        }
        if (starts(0x42, 0x4d)) return "image/bmp"
        if (count >= 6) {
            val signature = String(header, 0, 6, StandardCharsets.US_ASCII)
            if (signature == "GIF87a" || signature == "GIF89a") {
                return "image/gif"
            }
        }
        if (count >= 12) {
            val riff = String(header, 0, 4, StandardCharsets.US_ASCII)
            val kind = String(header, 8, 4, StandardCharsets.US_ASCII)
            if (riff == "RIFF" && kind == "WEBP") return "image/webp"
            if (riff == "RIFF" && kind == "AVI ") return "video/avi"
        }
        if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm"
        isoBaseMediaMime(header, count, name, declaredMime)?.let {
            return it
        }
        val textHead = String(
            header,
            0,
            count,
            StandardCharsets.UTF_8,
        ).lowercase(Locale.ROOT)
        if (textHead.contains("<svg")) return "image/svg+xml"
        return likelyMediaMime(name, declaredMime)
    }

    @Suppress("DEPRECATION")
    private fun collectUris(intent: Intent): List<Uri> {
        val extras = mutableListOf<Uri>()
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(
                Intent.EXTRA_STREAM,
            )?.let(extras::addAll)
        } else {
            intent.getParcelableExtra<Uri>(
                Intent.EXTRA_STREAM,
            )?.let(extras::add)
        }
        val clipped = mutableListOf<Uri>()
        intent.clipData?.let { clip ->
            for (index in 0 until clip.itemCount) {
                clip.getItemAt(index).uri?.let(clipped::add)
            }
        }
        val data = intent.data?.let(::listOf).orEmpty()
        val result = mutableListOf<Uri>()
        val resultCounts = mutableMapOf<Uri, Int>()
        // Android commonly mirrors the same items across EXTRA_STREAM, data
        // and ClipData. Merge by maximum occurrence count: mirrored values are
        // not duplicated, while an intentional duplicate inside one list stays.
        for (representation in listOf(extras, clipped, data)) {
            val seen = mutableMapOf<Uri, Int>()
            for (uri in representation) {
                val occurrence = (seen[uri] ?: 0) + 1
                seen[uri] = occurrence
                if ((resultCounts[uri] ?: 0) < occurrence) {
                    result += uri
                    resultCounts[uri] = occurrence
                }
            }
        }
        return result
    }

    private data class Metadata(
        val name: String,
        val mimeType: String,
        val declaredSize: Long?,
        val capturedAtMillis: Long?,
        val modifiedAtMillis: Long?,
    )

    private fun queryMetadata(uri: Uri): Metadata {
        var name: String? = null
        var size: Long? = null
        var capturedAtMillis: Long? = null
        var modifiedAtMillis: Long? = null
        var cursor: Cursor? = null
        try {
            // Projection=null is intentional: providers use different optional
            // names for capture/modified time. We inspect only known columns.
            cursor = context.contentResolver.query(uri, null, null, null, null)
            if (cursor?.moveToFirst() == true) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                fun time(column: String, seconds: Boolean = false): Long? {
                    val index = cursor.getColumnIndex(column)
                    if (index < 0 || cursor.isNull(index)) return null
                    val raw = cursor.getLong(index)
                    return if (seconds && raw in 1..9_999_999_999L) {
                        raw * 1_000L
                    } else {
                        raw
                    }
                }
                capturedAtMillis = time("datetaken")
                modifiedAtMillis = time("last_modified")
                    ?: time("date_modified", seconds = true)
            }
        } finally {
            cursor?.close()
        }
        val displayName = safeName(name ?: uri.lastPathSegment ?: "分享文件")
        val mimeType = context.contentResolver.getType(uri)?.lowercase(Locale.ROOT) ?: "application/octet-stream"
        return Metadata(
            displayName,
            mimeType,
            size,
            capturedAtMillis,
            modifiedAtMillis,
        )
    }

    private fun sanitizedName(
        originalName: String,
        result: MediaPrivacySanitizer.Result,
    ): String {
        val extension = result.preferredExtension ?: return originalName
        val stem = originalName.substringBeforeLast('.', originalName)
        return safeName("$stem.$extension")
    }

    private fun createEncryptedPreview(
        source: File,
        mimeType: String,
        attachmentId: String,
        store: EncryptedAttachmentStore,
    ): EncryptedPreview? {
        var clear: File? = null
        return try {
            val bytes = MediaPrivacySanitizer.previewBytes(source, mimeType)
                ?.takeIf { it.isNotEmpty() }
                ?: return null
            val previewId = "$attachmentId-preview"
            clear = File(source.parentFile, ".$previewId.clear")
            clear.writeBytes(bytes)
            val encrypted = store.encrypt(clear, previewId, deleteSource = true)
            EncryptedPreview(previewId, encrypted.file.absolutePath)
        } catch (_: Exception) {
            null
        } finally {
            // Encryption failures must never leave a private clear preview on
            // disk. The normal successful path has already deleted it.
            clear?.delete()
        }
    }

    private fun effectiveMediaMime(
        file: File,
        name: String,
        declaredMime: String,
    ): String {
        val declared = declaredMime.lowercase(Locale.ROOT)
        if (
            declared.startsWith("image/") ||
            declared.startsWith("video/") ||
            declared.startsWith("audio/")
        ) {
            return declared
        }
        val header = ByteArray(64)
        val count = file.inputStream().use { it.read(header) }.coerceAtLeast(0)
        fun starts(vararg bytes: Int): Boolean =
            count >= bytes.size &&
                bytes.indices.all { header[it].toInt() and 0xff == bytes[it] }
        if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"
        if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
            return "image/png"
        }
        if (count >= 6) {
            val signature = String(header, 0, 6, StandardCharsets.US_ASCII)
            if (signature == "GIF87a" || signature == "GIF89a") {
                return "image/gif"
            }
        }
        if (count >= 12) {
            val riff = String(header, 0, 4, StandardCharsets.US_ASCII)
            val kind = String(header, 8, 4, StandardCharsets.US_ASCII)
            if (riff == "RIFF" && kind == "WEBP") return "image/webp"
            if (riff == "RIFF" && kind == "AVI ") return "video/avi"
        }
        if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm"
        isoBaseMediaMime(header, count, name, declaredMime)?.let {
            return it
        }
        // Extension is only a fallback. A false declaration will enter the
        // sanitizer and fail safely rather than storing unchecked metadata.
        return when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "webp" -> "image/webp"
            "heic", "heif" -> "image/heic"
            "avif" -> "image/avif"
            "mp4", "m4v", "mov", "3gp", "3g2" -> "video/mp4"
            "m4a", "m4b", "m4p" -> "audio/mp4"
            "webm", "mkv" -> "video/webm"
            "avi" -> "video/avi"
            else -> declared
        }
    }

    private fun likelyMediaMime(name: String, declaredMime: String): String {
        val declared = declaredMime.lowercase(Locale.ROOT)
        if (
            declared.startsWith("image/") ||
            declared.startsWith("video/") ||
            declared.startsWith("audio/")
        ) {
            return declared
        }
        return when (
            name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        ) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "webp" -> "image/webp"
            "heic", "heif" -> "image/heic"
            "avif" -> "image/avif"
            "mp4", "m4v", "mov", "3gp", "3g2" -> "video/mp4"
            "m4a", "m4b", "m4p" -> "audio/mp4"
            "webm", "mkv" -> "video/webm"
            "avi" -> "video/avi"
            else -> declared
        }
    }

    private fun isoBaseMediaMime(
        header: ByteArray,
        count: Int,
        name: String,
        declaredMime: String,
    ): String? {
        if (
            count < 12 ||
            String(header, 4, 4, StandardCharsets.US_ASCII) != "ftyp"
        ) {
            return null
        }
        val brands = String(
            header,
            8,
            count - 8,
            StandardCharsets.ISO_8859_1,
        ).lowercase(Locale.ROOT)
        if (
            listOf("heic", "heix", "hevc", "hevx", "mif1", "msf1")
                .any(brands::contains)
        ) {
            return "image/heic"
        }
        if (brands.contains("avif") || brands.contains("avis")) {
            return "image/avif"
        }
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        val declared = declaredMime.lowercase(Locale.ROOT)
        if (
            declared.startsWith("audio/") ||
            extension in setOf("m4a", "m4b", "m4p") ||
            listOf("m4a ", "m4b ", "m4p ").any(brands::contains)
        ) {
            return if (declared.startsWith("audio/")) declared else "audio/mp4"
        }
        if (declared.startsWith("video/")) return declared
        if (
            extension in setOf("mp4", "m4v", "mov", "3gp", "3g2") ||
            listOf(
                "isom",
                "iso2",
                "iso5",
                "iso6",
                "mp41",
                "mp42",
                "avc1",
                "dash",
                "m4v ",
                "3gp",
                "3g2",
                "qt  ",
            ).any(brands::contains)
        ) {
            return "video/mp4"
        }
        // An unknown ISO-BMFF brand is not automatically a video. Keep it as
        // a generic file so audio and vendor containers are never remuxed or
        // renamed under a false media type.
        return null
    }

    private fun safeName(value: String): String {
        val clean = value.substringAfterLast('/').substringAfterLast('\\').replace("\u0000", "").trim().take(180)
        return clean.ifEmpty { "未命名文件" }
    }

    private fun utcAt(timestampMillis: Long): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(Date(timestampMillis))
    }

    private fun utcNow(): String = utcAt(System.currentTimeMillis())

}
