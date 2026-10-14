package com.ly.creatoros.ly_creator_capture

import android.app.Activity
import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors
import java.io.File
import java.util.UUID

class MainActivity : FlutterFragmentActivity() {
    companion object {
        private const val channelName = "ly.creator.capture/share_intake"
        private const val recordingChannelName = "ly.creator.capture/recording"
        private const val pickRequestCode = 7122
        private const val photoRequestCode = 7123
        private const val recordingPermissionRequestCode = 7124
        private const val mediaRequestCode = 7125
        private const val setupPermissionRequestCode = 7126
        const val actionOpenText = "ly.creator.capture.OPEN_TEXT"
        const val actionRecord = "ly.creator.capture.RECORD"
        const val actionTakePhoto = "ly.creator.capture.TAKE_PHOTO"
        const val actionSync = "ly.creator.capture.SYNC"
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var pendingPickResult: MethodChannel.Result? = null
    private var pendingPhotoFile: File? = null
    private var pendingRecordingResult: MethodChannel.Result? = null
    private var shareIntakeChannel: MethodChannel? = null
    private var setupPermissionResult: MethodChannel.Result? = null
    private var pendingQuickAction: String? = null
    private var maintenanceChannel: MethodChannel? = null
    private var importReceiverRegistered = false
    private val importReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            shareIntakeChannel?.invokeMethod("shareReady", null)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        executor.execute {
            ShareIntakeStore.cleanupAbandonedPlaintext(applicationContext)
        }
        ImportService.recoverPendingCameraImports(applicationContext)
        if (RecordingService.hasInterruptedRecording(applicationContext)) {
            ContextCompat.startForegroundService(
                this,
                Intent(this, RecordingService::class.java)
                    .setAction(RecordingService.actionRecover),
            )
        }
        val store = ShareIntakeStore(applicationContext)
        val maintenance = CaptureMaintenance(applicationContext).also {
            executor.execute {
                it.cleanupShareCache()
                it.cleanupUpdateCache()
            }
        }
        shareIntakeChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            channelName,
        ).also { channel -> channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "listPendingShares" -> result.success(store.listPending())
                "acknowledgeShare" -> {
                    val shareId = call.argument<String>("shareId")
                    if (shareId.isNullOrBlank()) result.error("invalid_share", "系统分享标识无效", null)
                    else try { store.acknowledge(shareId); result.success(null) } catch (error: Exception) {
                        result.error("ack_failed", error.message, null)
                    }
                }
                "pickFiles" -> {
                    if (pendingPickResult != null) {
                        result.error("picker_busy", "文件选择器正在打开", null)
                    } else {
                        pendingPickResult = result
                        val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                            addFlags(
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
                            )
                        }
                        startActivityForResult(picker, pickRequestCode)
                    }
                }
                "pickMedia" -> {
                    if (pendingPickResult != null) {
                        result.error("picker_busy", "相册或文件选择器正在打开", null)
                    } else {
                        pendingPickResult = result
                        val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            putExtra(
                                Intent.EXTRA_MIME_TYPES,
                                arrayOf("image/*", "video/*"),
                            )
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                            addFlags(
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
                            )
                        }
                        startActivityForResult(picker, mediaRequestCode)
                    }
                }
                "takePhoto" -> {
                    if (pendingPickResult != null) {
                        result.error("camera_busy", "相机或文件选择器正在打开", null)
                    } else {
                        val directory = File(filesDir, "mobile-camera").apply { mkdirs() }
                        val target = File(directory, "照片-${UUID.randomUUID()}.jpg")
                        pendingPhotoFile = target
                        pendingPickResult = result
                        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", target)
                        val camera = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
                            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        try {
                            startActivityForResult(camera, photoRequestCode)
                        } catch (error: Exception) {
                            pendingPhotoFile = null
                            pendingPickResult = null
                            result.error("camera_unavailable", "无法打开系统相机", error.message)
                        }
                    }
                }
                else -> result.notImplemented()
            }
        } }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, recordingChannelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "getState" -> result.success(RecordingService.snapshot())
                "start" -> startRecordingWithPermission(result)
                "pause" -> { recordingAction(RecordingService.actionPause); result.success(null) }
                "resume" -> { recordingAction(RecordingService.actionResume); result.success(null) }
                "mark" -> { recordingAction(RecordingService.actionMark); result.success(null) }
                "stop" -> { recordingAction(RecordingService.actionStop); result.success(null) }
                "discard" -> { recordingAction(RecordingService.actionDiscard); result.success(null) }
                else -> result.notImplemented()
            }
        }
        pendingQuickAction = quickAction(intent)
        maintenanceChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "ly.creator.capture/maintenance",
        ).also { channel -> channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "deletePrivateCopies" -> executor.execute {
                    runMaintenance(result) {
                        maintenance.deletePrivateCopies(attachments(call.arguments))
                        null
                    }
                }
                "shareCapture" -> executor.execute {
                    runMaintenance(result) {
                        val arguments = call.arguments as? Map<*, *> ?: emptyMap<Any, Any>()
                        maintenance.shareCapture(
                            arguments["title"] as? String ?: "",
                            arguments["content"] as? String ?: "",
                            arguments["notes"] as? String ?: "",
                            attachments(call.arguments),
                        )
                        null
                    }
                }
                "appStorageBytes" -> executor.execute {
                    runMaintenance(result, maintenance::appStorageBytes)
                }
                "setupStatus" -> result.success(setupStatus(maintenance))
                "requestCorePermissions" -> requestCorePermissions(result, maintenance)
                "openBatterySettings" -> {
                    openBatterySettings()
                    result.success(null)
                }
                "openAutoStartSettings" -> {
                    openAutoStartSettings()
                    result.success(null)
                }
                "openInstallSettings" -> {
                    openInstallSettings()
                    result.success(null)
                }
                "authenticate" -> authenticate(
                    call.argument<String>("reason") ?: "查看最近记录",
                    result,
                )
                "exportDiagnostics" -> executor.execute {
                    runMaintenance(result) {
                        val values = (call.arguments as? Map<*, *>)
                            ?.entries
                            ?.associate { it.key.toString() to it.value }
                            ?: emptyMap()
                        maintenance.exportDiagnostics(values)
                        null
                    }
                }
                "updateWidget" -> {
                    CaptureWidgetProvider.updateAll(
                        applicationContext,
                        call.argument<Int>("pendingCount") ?: 0,
                        call.argument<Boolean>("recording") == true,
                    )
                    result.success(null)
                }
                "consumeQuickAction" -> {
                    result.success(pendingQuickAction)
                    pendingQuickAction = null
                }
                "setScreenProtection" -> {
                    if (call.argument<Boolean>("enabled") == true) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                    result.success(null)
                }
                "installUpdate" -> executor.execute {
                    runMaintenance(result) {
                        maintenance.installUpdate(
                            call.argument<String>("url") ?: "",
                            call.argument<String>("sha256") ?: "",
                            (call.argument<Number>("sizeBytes")?.toLong() ?: 0L),
                            (call.argument<Number>("versionCode")?.toLong() ?: 0L),
                        )
                        null
                    }
                }
                else -> result.notImplemented()
            }
        } }
    }

    override fun onStart() {
        super.onStart()
        if (!importReceiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                importReceiver,
                IntentFilter("ly.creator.import.CHANGED"),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            importReceiverRegistered = true
        }
    }

    override fun onStop() {
        if (importReceiverRegistered) {
            unregisterReceiver(importReceiver)
            importReceiverRegistered = false
        }
        super.onStop()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != pickRequestCode &&
            requestCode != mediaRequestCode &&
            requestCode != photoRequestCode
        ) return
        val result = pendingPickResult ?: return
        pendingPickResult = null
        if (resultCode != Activity.RESULT_OK ||
            (requestCode != photoRequestCode && data == null)
        ) {
            pendingPhotoFile?.delete()
            pendingPhotoFile = null
            result.success(null)
            return
        }
        try {
            val jobId = UUID.randomUUID().toString()
            if (requestCode == photoRequestCode) {
                val file = pendingPhotoFile
                if (file == null || !file.isFile || file.length() <= 0L) {
                    file?.delete()
                    pendingPhotoFile = null
                    result.error("camera_failed", "拍照文件不存在或为空", null)
                    return
                }
                ImportService.enqueueCamera(
                    this,
                    file,
                    jobId,
                )
                // The encrypted recovery manifest now owns the photo.
                pendingPhotoFile = null
            } else {
                val source = requireNotNull(data)
                val persistedGrants = persistReadPermissions(source)
                ImportService.enqueue(
                    this,
                    source,
                    if (requestCode == mediaRequestCode) {
                        "Android相册"
                    } else {
                        "Android文件选择器"
                    },
                    jobId,
                    persistedUriGrants = persistedGrants,
                )
            }
            // ImportService owns the durable job from here. The queue broadcast
            // will insert the finished record without keeping this Activity alive.
            result.success(null)
        } catch (error: Exception) {
            if (requestCode == photoRequestCode) {
                pendingPhotoFile?.let { file ->
                    if (!File("${file.absolutePath}.pending.lyenc").exists()) {
                        file.delete()
                    }
                }
                pendingPhotoFile = null
            }
            result.error("copy_failed", "无法启动后台安全保存", error.message)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        quickAction(intent)?.let { action ->
            pendingQuickAction = action
            val channel = maintenanceChannel
            if (channel == null) return@let
            channel.invokeMethod(
                "quickAction",
                action,
                object : MethodChannel.Result {
                    override fun success(result: Any?) {
                        if (pendingQuickAction == action) pendingQuickAction = null
                    }

                    override fun error(
                        errorCode: String,
                        errorMessage: String?,
                        errorDetails: Any?,
                    ) = Unit

                    override fun notImplemented() = Unit
                },
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun persistReadPermissions(source: Intent): List<String> {
        val uris = mutableListOf<android.net.Uri>()
        source.getParcelableArrayListExtra<android.net.Uri>(
            Intent.EXTRA_STREAM,
        )?.let(uris::addAll)
        source.getParcelableExtra<android.net.Uri>(
            Intent.EXTRA_STREAM,
        )?.let(uris::add)
        source.data?.let(uris::add)
        source.clipData?.let { clip ->
            for (index in 0 until clip.itemCount) {
                clip.getItemAt(index).uri?.let(uris::add)
            }
        }
        return uris.distinct().mapNotNull { uri ->
            runCatching {
                contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
                uri.toString()
            }.getOrNull()
        }
    }

    private fun startRecordingWithPermission(result: MethodChannel.Result) {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        val missing = permissions.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
            recordingAction(RecordingService.actionStart)
            result.success(null)
        } else {
            pendingRecordingResult = result
            requestPermissions(missing.toTypedArray(), recordingPermissionRequestCode)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == setupPermissionRequestCode) {
            val result = setupPermissionResult ?: return
            setupPermissionResult = null
            result.success(setupStatus(CaptureMaintenance(applicationContext)))
            return
        }
        if (requestCode != recordingPermissionRequestCode) return
        val result = pendingRecordingResult ?: return
        pendingRecordingResult = null
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            recordingAction(RecordingService.actionStart)
            result.success(null)
        } else {
            result.error("microphone_denied", "需要麦克风和通知权限才能后台录音", null)
        }
    }

    private fun requestCorePermissions(
        result: MethodChannel.Result,
        maintenance: CaptureMaintenance,
    ) {
        if (setupPermissionResult != null) {
            result.error("permission_busy", "权限设置正在进行", null)
            return
        }
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
        )
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            result.success(setupStatus(maintenance))
        } else {
            setupPermissionResult = result
            requestPermissions(missing.toTypedArray(), setupPermissionRequestCode)
        }
    }

    private fun setupStatus(maintenance: CaptureMaintenance): Map<String, Any> {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        return mapOf(
            "microphone" to hasPermission(Manifest.permission.RECORD_AUDIO),
            "camera" to hasPermission(Manifest.permission.CAMERA),
            "notifications" to (
                Build.VERSION.SDK_INT < 33 ||
                    hasPermission(Manifest.permission.POST_NOTIFICATIONS)
                ),
            "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(packageName),
            "installUpdates" to packageManager.canRequestPackageInstalls(),
            "isOppo" to Build.MANUFACTURER.equals("oppo", ignoreCase = true),
            "appVersion" to maintenance.appVersion(),
            "appVersionCode" to maintenance.appVersionCode(),
        )
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) ==
            PackageManager.PERMISSION_GRANTED

    private fun openBatterySettings() {
        val direct = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName"),
        )
        runCatching { startActivity(direct) }.getOrElse {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun openAutoStartSettings() {
        val candidates = listOf(
            "com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.oplus.safecenter/com.oplus.safecenter.startupapp.StartupAppListActivity",
            "com.oppo.safe/com.oppo.safe.permission.startup.StartupAppListActivity",
        )
        for (candidate in candidates) {
            val parts = candidate.split("/")
            val intent = Intent().setClassName(parts[0], parts[1])
            if (runCatching { startActivity(intent) }.isSuccess) return
        }
        startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName"),
            ),
        )
    }

    private fun openInstallSettings() {
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName"),
            ),
        )
    }

    private fun authenticate(reason: String, result: MethodChannel.Result) {
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    authenticationResult: BiometricPrompt.AuthenticationResult,
                ) {
                    result.success(true)
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence,
                ) {
                    result.success(false)
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("解锁最近记录")
                .setSubtitle(reason.take(100))
                .setAllowedAuthenticators(
                    androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL,
                )
                .build(),
        )
    }

    private fun attachments(arguments: Any?): List<CaptureMaintenance.Attachment> {
        val raw = (arguments as? Map<*, *>)?.get("attachments") as? List<*>
            ?: return emptyList()
        return raw.map { item ->
            val value = item as? Map<*, *>
                ?: throw IllegalArgumentException("附件参数无效")
            CaptureMaintenance.Attachment(
                id = value["attachmentId"] as? String
                    ?: throw IllegalArgumentException("附件标识无效"),
                path = value["path"] as? String
                    ?: throw IllegalArgumentException("附件位置无效"),
                name = value["name"] as? String ?: "附件",
                mimeType = value["mimeType"] as? String ?: "application/octet-stream",
                previewId = value["previewAttachmentId"] as? String,
                previewPath = value["previewPath"] as? String,
            )
        }
    }

    private fun quickAction(intent: Intent?): String? = when (intent?.action) {
        actionOpenText -> "text"
        actionRecord -> "record"
        actionTakePhoto -> "camera"
        actionSync -> "sync"
        else -> null
    }

    private fun <T> runMaintenance(
        result: MethodChannel.Result,
        action: () -> T,
    ) {
        try {
            val value = action()
            runOnUiThread { result.success(value) }
        } catch (error: Exception) {
            runOnUiThread {
                result.error("maintenance_failed", error.message, null)
            }
        }
    }

    private fun recordingAction(action: String) {
        val intent = Intent(this, RecordingService::class.java).setAction(action)
        if (action == RecordingService.actionStart) ContextCompat.startForegroundService(this, intent)
        else startService(intent)
    }

    override fun onDestroy() {
        pendingPickResult?.error("activity_closed", "文件选择已取消", null)
        pendingPickResult = null
        pendingRecordingResult?.error("activity_closed", "录音权限申请已取消", null)
        pendingRecordingResult = null
        setupPermissionResult?.error("activity_closed", "权限设置已取消", null)
        setupPermissionResult = null
        shareIntakeChannel = null
        executor.shutdownNow()
        super.onDestroy()
    }
}
