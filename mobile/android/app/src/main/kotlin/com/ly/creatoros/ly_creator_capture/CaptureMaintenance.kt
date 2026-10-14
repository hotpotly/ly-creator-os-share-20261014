package com.ly.creatoros.ly_creator_capture

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.ly.creatoros.secure_attachment_storage.EncryptedAttachmentStore
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CaptureMaintenance(private val context: Context) {
    private val store = EncryptedAttachmentStore(context)

    data class Attachment(
        val id: String,
        val path: String,
        val name: String,
        val mimeType: String,
        val previewId: String?,
        val previewPath: String?,
    )

    fun deletePrivateCopies(attachments: List<Attachment>) {
        for (attachment in attachments) {
            deletePrivateFile(attachment.path)
            attachment.previewPath?.let(::deletePrivateFile)
        }
    }

    fun shareCapture(
        title: String,
        content: String,
        notes: String,
        attachments: List<Attachment>,
    ) {
        cleanupShareCache()
        val directory = File(context.cacheDir, "shared-records/${UUID.randomUUID()}")
            .apply { mkdirs() }
        val activeMarker = File(directory, ".generating").apply {
            writeText("share cache is being prepared")
        }
        val heartbeat = Executors.newSingleThreadScheduledExecutor().apply {
            scheduleAtFixedRate(
                {
                    activeMarker.takeIf(File::exists)
                        ?.setLastModified(System.currentTimeMillis())
                },
                1,
                1,
                TimeUnit.MINUTES,
            )
        }
        val cleanupName = ShareCacheCleanupWorker.uniqueName(directory.name)
        try {
            // 先登记持久清理任务，再开始生成任何分享明文。即使进程在多附件
            // 解密中被系统终止，WorkManager也会在稍后清掉这一批缓存。活动标记
            // 每分钟续期，避免超大文件仍在解密时被清理任务误删。
            WorkManager.getInstance(context).enqueueUniqueWork(
                cleanupName,
                ExistingWorkPolicy.REPLACE,
                ShareCacheCleanupWorker.request(
                    batchId = directory.name,
                    initialDelay = 1,
                    delayUnit = TimeUnit.DAYS,
                ),
            ).result.get()
            val files = attachments.mapIndexed { index, attachment ->
                val source = privateFile(attachment.path)
                if (!source.isFile) throw IllegalStateException("手机附件副本不存在")
                val destination = File(
                    directory,
                    "${index.toString().padStart(2, '0')}-${safeName(attachment.name)}",
                )
                store.decryptToFile(source, attachment.id, destination)
                destination to attachment.mimeType
            }
            val text = listOf(title.trim(), content.trim(), notes.trim())
                .filter { it.isNotEmpty() }
                .joinToString("\n\n")
            val intent = when (files.size) {
                0 -> Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }
                1 -> Intent(Intent.ACTION_SEND).apply {
                    type = files.single().second.ifBlank { "*/*" }
                    putExtra(Intent.EXTRA_STREAM, contentUri(files.single().first))
                    if (text.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, text)
                    clipData = ClipData.newRawUri(
                        files.single().first.name,
                        contentUri(files.single().first),
                    )
                }
                else -> Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                    type = if (files.map { it.second }.distinct().size == 1) {
                        files.first().second
                    } else {
                        "*/*"
                    }
                    val uris = ArrayList(files.map { contentUri(it.first) })
                    putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                    if (text.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, text)
                    clipData = ClipData.newUri(
                        context.contentResolver,
                        files.first().first.name,
                        uris.first(),
                    ).also { clip ->
                        uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
                    }
                }
            }.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK,
            )
            val leaseMarker = File(directory, ".lease")
            if (!activeMarker.renameTo(leaseMarker)) {
                leaseMarker.writeText("share cache is leased to Android chooser")
                if (!activeMarker.delete()) {
                    throw IllegalStateException("分享缓存租约建立失败")
                }
            }
            leaseMarker.setLastModified(System.currentTimeMillis())
            context.startActivity(
                Intent.createChooser(intent, "分享这条记录")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            // Android不会告知FileProvider目标App何时读完文件；保留租约到
            // 一天后的持久清理，避免用户停在分享面板或接收方复制超大文件时
            // 被启动清理误删。App崩溃后同一任务也会完成清理。
        } catch (error: Exception) {
            directory.deleteRecursively()
            WorkManager.getInstance(context).cancelUniqueWork(cleanupName)
            throw error
        } finally {
            heartbeat.shutdownNow()
        }
    }

    fun appStorageBytes(): Long {
        val roots = listOf(
            context.filesDir,
            context.cacheDir,
            File(context.applicationInfo.dataDir, "databases"),
            File(context.applicationInfo.dataDir, "shared_prefs"),
        )
        return roots.distinctBy { it.absolutePath }.sumOf(::directoryBytes)
    }

    fun exportDiagnostics(values: Map<String, Any?>) {
        val directory = File(context.cacheDir, "diagnostics").apply { mkdirs() }
        directory.listFiles().orEmpty().forEach(File::delete)
        val file = File(directory, "LY快速记录-诊断-${System.currentTimeMillis()}.json")
        val payload = JSONObject().apply {
            put("generatedAt", java.time.Instant.now().toString())
            put("appVersion", appVersion())
            put("androidSdk", Build.VERSION.SDK_INT)
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("telemetry", false)
            values.forEach { (key, value) ->
                if (key.matches(Regex("[A-Za-z][A-Za-z0-9]{0,63}"))) {
                    put(key, value)
                }
            }
        }
        FileOutputStream(file).use { output ->
            output.write(payload.toString(2).toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        val uri = contentUri(file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK,
            )
        }
        context.startActivity(
            Intent.createChooser(intent, "导出脱敏诊断包")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun installUpdate(
        url: String,
        expectedSha256: String,
        expectedSize: Long,
        expectedVersionCode: Long,
    ) {
        require(expectedSha256.matches(Regex("[0-9a-f]{64}"))) { "更新摘要无效" }
        require(expectedSize in 1..(512L * 1024 * 1024)) { "更新包大小无效" }
        require(expectedVersionCode > appVersionCode()) { "更新版本无效" }
        val parsed = URL(url)
        require(parsed.protocol == "http") { "更新只允许来自主Mac局域网地址" }
        val address = InetAddress.getByName(parsed.host)
        require(address is Inet4Address && isPrivate(address.address)) {
            "更新只允许来自主Mac局域网地址"
        }
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        directory.listFiles().orEmpty().forEach(File::delete)
        val target = File(directory, "ly-creator-update.apk")
        val temporary = File(directory, ".ly-creator-update.partial")
        val digest = MessageDigest.getInstance("SHA-256")
        var copied = 0L
        try {
            WorkManager.getInstance(context).enqueueUniqueWork(
                UpdateCacheCleanupWorker.uniqueName,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<UpdateCacheCleanupWorker>()
                    .setInitialDelay(1, TimeUnit.DAYS)
                    .build(),
            ).result.get()
            val connection = parsed.openConnection() as HttpURLConnection
            connection.connectTimeout = 6_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = false
            require(connection.responseCode == HttpURLConnection.HTTP_OK) {
                "主Mac没有返回有效更新包"
            }
            val declaredLength = connection.contentLengthLong
            require(declaredLength < 0 || declaredLength == expectedSize) {
                "更新包声明大小不一致"
            }
            connection.inputStream.use { input ->
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        copied += count
                        if (copied > expectedSize) throw IllegalStateException("更新包大小不一致")
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            require(copied == expectedSize) { "更新包下载不完整" }
            require(digest.digest().joinToString("") { "%02x".format(it) } == expectedSha256) {
                "更新包校验失败"
            }
            if (!temporary.renameTo(target)) throw IllegalStateException("更新包保存失败")
            require(expectedUpdatePackage(target, expectedVersionCode)) {
                "更新包身份、版本或签名与当前App不一致"
            }
            val uri = contentUri(target)
            context.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_ACTIVITY_NEW_TASK,
                    )
                },
            )
        } catch (error: Exception) {
            target.delete()
            throw error
        } finally {
            temporary.delete()
        }
    }

    fun appVersion(): String =
        context.packageManager.getPackageInfo(context.packageName, 0)
            .versionName ?: ""

    fun appVersionCode(): Long =
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode

    fun cleanupShareCache(
        maxAgeMs: Long = 60 * 60 * 1000L,
        generatingStaleMs: Long = 10 * 60 * 1000L,
        leaseMaxAgeMs: Long = 24 * 60 * 60 * 1000L,
    ) {
        File(context.cacheDir, "shared-records").listFiles().orEmpty()
            .forEach { directory ->
                cleanupShareBatch(
                    directory.name,
                    maxAgeMs = maxAgeMs,
                    generatingStaleMs = generatingStaleMs,
                    leaseMaxAgeMs = leaseMaxAgeMs,
                )
            }
    }

    fun cleanupShareBatch(
        batchId: String,
        maxAgeMs: Long,
        generatingStaleMs: Long,
        leaseMaxAgeMs: Long,
    ): Boolean {
        require(batchId.matches(Regex("[0-9a-fA-F-]{36}"))) { "分享缓存标识无效" }
        val root = File(context.cacheDir, "shared-records").canonicalFile
        val directory = File(root, batchId).canonicalFile
        require(directory.parentFile == root) { "分享缓存位置无效" }
        if (!directory.exists()) return true
        val generatingMarker = File(directory, ".generating")
        val leaseMarker = File(directory, ".lease")
        val marker = when {
            generatingMarker.exists() -> generatingMarker
            leaseMarker.exists() -> leaseMarker
            else -> directory
        }
        val age = System.currentTimeMillis() - marker.lastModified()
        val threshold = when (marker) {
            generatingMarker -> generatingStaleMs
            leaseMarker -> leaseMaxAgeMs
            else -> maxAgeMs
        }
        if (age < threshold) return false
        return directory.deleteRecursively() || !directory.exists()
    }

    fun cleanupUpdateCache(maxAgeMs: Long = 12 * 60 * 60 * 1000L) {
        val cutoff = System.currentTimeMillis() - maxAgeMs
        File(context.cacheDir, "updates").listFiles().orEmpty()
            .filter { it.lastModified() < cutoff }
            .forEach(File::delete)
    }

    private fun expectedUpdatePackage(apk: File, expectedVersionCode: Long): Boolean {
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val current = context.packageManager.getPackageInfo(context.packageName, flags)
        val archive = context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
            ?: return false
        if (
            archive.packageName != context.packageName ||
            archive.longVersionCode != expectedVersionCode
        ) return false
        fun certificates(info: android.content.pm.PackageInfo): Set<String> {
            val signing = info.signingInfo ?: return emptySet()
            return signing.apkContentsSigners.map { signer ->
                MessageDigest.getInstance("SHA-256")
                    .digest(signer.toByteArray())
                    .joinToString("") { "%02x".format(it) }
            }.toSet()
        }
        return certificates(current).isNotEmpty() &&
            certificates(current) == certificates(archive)
    }

    private fun privateFile(path: String): File {
        val root = context.filesDir.canonicalFile
        val file = File(path).canonicalFile
        require(file.path.startsWith("${root.path}${File.separator}")) {
            "附件位置不属于App私有目录"
        }
        return file
    }

    private fun deletePrivateFile(path: String) {
        val file = privateFile(path)
        if (file.exists() && !file.delete()) throw IllegalStateException("手机附件副本删除失败")
    }

    private fun contentUri(file: File): Uri =
        FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file,
        )

    private fun safeName(value: String): String {
        val clean = value
            .replace(Regex("""[\\/\u0000-\u001f]"""), "_")
            .trim()
            .take(180)
        return clean.ifBlank { "附件" }
    }

    private fun directoryBytes(file: File): Long {
        if (!file.exists()) return 0
        if (file.isFile) return file.length()
        return file.listFiles().orEmpty().sumOf(::directoryBytes)
    }

    private fun isPrivate(bytes: ByteArray): Boolean {
        val first = bytes[0].toInt() and 0xff
        val second = bytes[1].toInt() and 0xff
        return first == 10 ||
            (first == 172 && second in 16..31) ||
            (first == 192 && second == 168) ||
            first == 127
    }
}
