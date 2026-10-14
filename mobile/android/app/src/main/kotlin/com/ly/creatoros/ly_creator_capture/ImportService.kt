package com.ly.creatoros.ly_creator_capture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.Context
import android.net.Uri
import android.content.ClipData
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.ly.creatoros.secure_attachment_storage.SecureValueStore
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class ImportService : Service() {
    companion object {
        const val actionImport = "ly.creator.import.CAPTURE"
        const val extraSourceApp = "com.ly.creatoros.extra.SOURCE_APP"
        const val extraImportJobId = "com.ly.creatoros.extra.IMPORT_JOB_ID"
        const val extraOriginalAction = "com.ly.creatoros.extra.ORIGINAL_ACTION"
        const val extraOriginalType = "com.ly.creatoros.extra.ORIGINAL_TYPE"
        const val extraCleanupSourcePath = "com.ly.creatoros.extra.CLEANUP_SOURCE_PATH"
        const val extraSharedAtMillis = "com.ly.creatoros.extra.SHARED_AT_MILLIS"
        const val extraPersistedUriGrants = "com.ly.creatoros.extra.PERSISTED_URI_GRANTS"
        private const val channelId = "ly_creator_import"
        private const val notificationId = 4201

        fun enqueue(
            context: Context,
            sourceIntent: Intent,
            sourceApp: String?,
            jobId: String,
            cleanupSourcePath: String? = null,
            persistedUriGrants: List<String> = emptyList(),
            sharedAtMillis: Long = System.currentTimeMillis(),
        ) {
            val work = Intent(context, ImportService::class.java).apply {
                action = actionImport
                sourceIntent.extras?.let(::putExtras)
                clipData = sourceIntent.clipData
                data = sourceIntent.data
                putExtra(extraImportJobId, jobId)
                putExtra(extraOriginalAction, sourceIntent.action)
                putExtra(extraOriginalType, sourceIntent.type)
                putExtra(extraSourceApp, sourceApp)
                putExtra(extraCleanupSourcePath, cleanupSourcePath)
                putExtra(extraSharedAtMillis, sharedAtMillis)
                putStringArrayListExtra(
                    extraPersistedUriGrants,
                    ArrayList(persistedUriGrants),
                )
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ContextCompat.startForegroundService(context, work)
        }

        fun enqueueCamera(
            context: Context,
            file: File,
            jobId: String,
            sharedAtMillis: Long = System.currentTimeMillis(),
        ) {
            writeCameraRecovery(
                file,
                jobId,
                sharedAtMillis,
            )
            enqueueCameraRecovered(context, file, jobId, sharedAtMillis)
        }

        fun recoverPendingCameraImports(context: Context) {
            val directory = File(context.filesDir, "mobile-camera")
            directory.listFiles { file ->
                file.isFile && file.name.endsWith(".pending.lyenc")
            }.orEmpty().forEach { checkpoint ->
                runCatching {
                    val value = JSONObject(
                        SecureValueStore().decrypt(checkpoint.readText()),
                    )
                    val file = File(value.getString("path"))
                    val root = directory.canonicalFile
                    val candidate = file.canonicalFile
                    if (
                        !candidate.path.startsWith(
                            "${root.path}${File.separator}",
                        ) ||
                        !candidate.isFile
                    ) {
                        checkpoint.delete()
                        return@runCatching
                    }
                    enqueueCameraRecovered(
                        context,
                        candidate,
                        value.getString("jobId"),
                        value.getLong("sharedAtMillis"),
                    )
                }
            }
        }

        private fun enqueueCameraRecovered(
            context: Context,
            file: File,
            jobId: String,
            sharedAtMillis: Long,
        ) {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file,
            )
            val source = Intent(Intent.ACTION_SEND).apply {
                type = "image/jpeg"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri("photo", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            enqueue(
                context,
                source,
                "LY快速记录相机",
                jobId,
                cleanupSourcePath = file.absolutePath,
                sharedAtMillis = sharedAtMillis,
            )
        }

        private fun writeCameraRecovery(
            file: File,
            jobId: String,
            sharedAtMillis: Long,
        ) {
            val target = cameraRecoveryFile(file)
            val temporary = File(target.parentFile, ".${target.name}.partial")
            val encrypted = SecureValueStore().encrypt(
                JSONObject().apply {
                    put("path", file.absolutePath)
                    put("jobId", jobId)
                    put("sharedAtMillis", sharedAtMillis)
                }.toString(),
            )
            try {
                FileOutputStream(temporary).use { output ->
                    output.write(encrypted.toByteArray(Charsets.UTF_8))
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

        private fun cameraRecoveryFile(file: File): File =
            File("${file.absolutePath}.pending.lyenc")
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val activeJobs = AtomicInteger(0)

    override fun onCreate() {
        super.onCreate()
        ShareIntakeStore.cleanupAbandonedPlaintext(applicationContext)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channelId, "安全导入", NotificationManager.IMPORTANCE_LOW).apply {
                description = "把系统分享的大文件复制进手机私有资料库"
                setShowBadge(false)
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != actionImport) return START_NOT_STICKY
        ServiceCompat.startForeground(
            this,
            notificationId,
            notification("正在安全保存分享内容…", ongoing = true),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        activeJobs.incrementAndGet()
        executor.execute {
            val manager = getSystemService(NotificationManager::class.java)
            var result = ShareIntakeStore.Result(
                null,
                "分享内容安全保存未完成",
            )
            try {
                val sourceIntent = Intent(
                    intent.getStringExtra(extraOriginalAction),
                ).apply {
                    type = intent.getStringExtra(extraOriginalType)
                    clipData = intent.clipData
                    data = intent.data
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    intent.extras?.let(::putExtras)
                }
                result = ShareIntakeStore(applicationContext).captureIntent(
                    sourceIntent,
                    persist = true,
                    sourceApp = intent.getStringExtra(extraSourceApp),
                    shareId = intent.getStringExtra(extraImportJobId),
                    onProgress = { copiedBytes, totalBytes ->
                        manager.notify(
                            notificationId,
                            notification(
                                importProgressText(copiedBytes, totalBytes),
                                ongoing = true,
                            ),
                        )
                    },
                    onStage = { stage ->
                        manager.notify(
                            notificationId,
                            notification(stage, ongoing = true),
                        )
                    },
                )
                if (result.error == null) {
                    cleanupInternalCameraSource(
                        intent.getStringExtra(extraCleanupSourcePath),
                    )
                    runCatching {
                        BackgroundSyncScheduler.enqueue(applicationContext)
                    }
                }
            } catch (error: Exception) {
                result = ShareIntakeStore.Result(
                    null,
                    error.message ?: "分享内容安全保存未完成",
                )
            } finally {
                if (result.error != null) {
                    intent.getStringExtra(extraImportJobId)?.let { jobId ->
                        runCatching {
                            ShareIntakeStore(applicationContext)
                                .discardIncompleteImport(jobId)
                        }
                    }
                }
                // Once this attempt has copied the source or returned a terminal
                // error there is no hidden retry UI that can safely own a
                // persistable grant. Release it on every completed attempt.
                releasePersistedUriGrants(
                    intent.getStringArrayListExtra(extraPersistedUriGrants)
                        .orEmpty(),
                )
                runCatching {
                    sendBroadcast(
                        Intent("ly.creator.import.CHANGED")
                            .setPackage(packageName),
                    )
                }
                val remaining = activeJobs.decrementAndGet().coerceAtLeast(0)
                val stopped = stopSelfResult(startId)
                runCatching {
                    if (remaining == 0 && stopped) {
                        manager.notify(
                            notificationId,
                            notification(
                                if (result.error == null) {
                                    "分享内容已安全保存"
                                } else {
                                    result.error
                                },
                                ongoing = false,
                            ),
                        )
                        stopForeground(STOP_FOREGROUND_DETACH)
                    } else {
                        manager.notify(
                            notificationId,
                            notification(
                                "正在安全保存，队列中还有${remaining.coerceAtLeast(1)}项",
                                ongoing = true,
                            ),
                        )
                    }
                }
            }
        }
        return START_REDELIVER_INTENT
    }

    private fun cleanupInternalCameraSource(path: String?) {
        if (path.isNullOrBlank()) return
        val cameraRoot = File(filesDir, "mobile-camera").canonicalFile
        val candidate = File(path).canonicalFile
        if (
            candidate.path.startsWith("${cameraRoot.path}${File.separator}") &&
            candidate.isFile
        ) {
            if (candidate.delete()) {
                cameraRecoveryFile(candidate).delete()
            }
        } else if (
            candidate.path.startsWith("${cameraRoot.path}${File.separator}") &&
            !candidate.exists()
        ) {
            cameraRecoveryFile(candidate).delete()
        }
    }

    private fun releasePersistedUriGrants(values: List<String>) {
        values.distinct().forEach { value ->
            runCatching {
                contentResolver.releasePersistableUriPermission(
                    Uri.parse(value),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
        }
    }

    private fun notification(text: String?, ongoing: Boolean) =
        NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("LY快速记录")
            .setContentText(text ?: "安全导入状态")
            .setOngoing(ongoing)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    packageManager.getLaunchIntentForPackage(packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    private fun importProgressText(copiedBytes: Long, totalBytes: Long?): String {
        val copied = formatBytes(copiedBytes)
        return if (totalBytes != null && totalBytes > 0L) {
            "正在安全保存 $copied／${formatBytes(totalBytes)}"
        } else {
            "正在安全保存 $copied"
        }
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024 * 1024 ->
            "%.1fGB".format(bytes / (1024.0 * 1024 * 1024))
        bytes >= 1024L * 1024 ->
            "%.1fMB".format(bytes / (1024.0 * 1024))
        bytes >= 1024L ->
            "%.1fKB".format(bytes / 1024.0)
        else -> "${bytes}B"
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
