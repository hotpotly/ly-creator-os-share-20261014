package com.ly.creatoros.ly_creator_capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.ly.creatoros.secure_attachment_storage.EncryptedAttachmentStore
import com.ly.creatoros.secure_attachment_storage.SecureValueStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

class RecordingService : Service(), MediaRecorder.OnErrorListener {
    companion object {
        const val actionRecover = "ly.creator.recording.RECOVER"
        const val actionStart = "ly.creator.recording.START"
        const val actionPause = "ly.creator.recording.PAUSE"
        const val actionResume = "ly.creator.recording.RESUME"
        const val actionMark = "ly.creator.recording.MARK"
        const val actionStop = "ly.creator.recording.STOP"
        const val actionDiscard = "ly.creator.recording.DISCARD"
        const val broadcastChanged = "ly.creator.recording.CHANGED"
        private const val channelId = "ly_creator_recording"
        private const val notificationId = 4101
        private const val journalName = "ly_recording_journal"
        private const val journalPayload = "encrypted_payload_v2"
        private const val segmentDurationMs = 2 * 60_000L

        @Volatile private var state = "idle"
        @Volatile private var startedAtElapsed = 0L
        @Volatile private var pausedAtElapsed = 0L
        @Volatile private var pausedTotal = 0L
        private val markers = mutableListOf<Long>()

        fun hasInterruptedRecording(context: Context): Boolean =
            context.getSharedPreferences(journalName, Context.MODE_PRIVATE)
                .contains(journalPayload)

        fun snapshot(): Map<String, Any?> = synchronized(markers) {
            val duration = when (state) {
                "recording" -> SystemClock.elapsedRealtime() -
                    startedAtElapsed - pausedTotal
                "paused" -> pausedAtElapsed - startedAtElapsed - pausedTotal
                else -> 0L
            }.coerceAtLeast(0L)
            mapOf(
                "state" to state,
                "durationMs" to duration,
                "markersMs" to markers.toList(),
            )
        }
    }

    private data class PendingSegment(
        val index: Int,
        val id: String,
        val path: String,
    )

    private data class EncryptedSegment(
        val index: Int,
        val id: String,
        val path: String,
        val clearSize: Long,
        val sha256: String,
    )

    private data class Journal(
        val recordingId: String,
        val nextSegmentIndex: Int,
        val current: PendingSegment?,
        val pending: List<PendingSegment>,
        val encrypted: List<EncryptedSegment>,
        val markersMs: List<Long>,
        val interruptionReason: String?,
        val discardRequested: Boolean,
    )

    private var recorder: MediaRecorder? = null
    private var focusRequest: AudioFocusRequest? = null
    private var currentSegment: PendingSegment? = null
    private val pendingSegments = mutableListOf<PendingSegment>()
    private val encryptedSegments = mutableListOf<EncryptedSegment>()
    private var recordingId: String? = null
    private var nextSegmentIndex = 0
    private var interruptionReason: String? = null
    private var discardRequested = false
    private var pendingStartAfterRecovery = false
    private var finalizing = false
    private val journalLock = Any()
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val secureValues = SecureValueStore()
    private val notificationTicker = object : Runnable {
        override fun run() {
            if (state != "idle") {
                updateNotification()
                handler.postDelayed(this, 30_000)
            }
        }
    }
    private val segmentTicker = object : Runnable {
        override fun run() {
            if (state == "recording") rotateSegment()
            if (state == "recording" || state == "paused") {
                handler.postDelayed(this, segmentDurationMs)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                channelId,
                "灵感录音",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "后台与锁屏录音控制"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            when (intent?.action) {
                actionRecover -> recoverIfNeeded(startAfter = false)
                actionStart -> recoverIfNeeded(startAfter = true)
                actionPause -> pauseRecording()
                actionResume -> resumeRecording()
                actionMark -> markRecording()
                actionStop -> finishRecording(discard = false, reason = null)
                actionDiscard -> finishRecording(discard = true, reason = null)
            }
        } catch (error: Exception) {
            if (state == "recording" || state == "paused") {
                finishRecording(
                    discard = false,
                    reason = error.message ?: "录音异常中断",
                )
            } else {
                showTerminalNotification(error.message ?: "录音无法开始")
                state = "idle"
                stopForeground(STOP_FOREGROUND_DETACH)
                stopSelf()
            }
        }
        notifyChanged()
        return START_NOT_STICKY
    }

    private fun recoverIfNeeded(startAfter: Boolean) {
        if (state != "idle") return
        ensureForeground(
            "正在检查录音恢复状态…",
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        val journal = loadJournal()
        if (journal == null) {
            if (startAfter) startNewRecording() else {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return
        }
        pendingStartAfterRecovery = startAfter
        restoreJournal(journal)
        if (!discardRequested) {
            interruptionReason = "录音进程异常中断"
        }
        currentSegment?.let {
            pendingSegments.removeAll { pending -> pending.id == it.id }
            pendingSegments += it
            currentSegment = null
        }
        pendingSegments.removeAll { segment ->
            val clear = File(segment.path)
            val encrypted = File(clear.parentFile, "${segment.id}.lyenc")
            !clear.exists() && !encrypted.exists()
        }
        encryptedSegments.removeAll { !File(it.path).exists() }
        persistJournal()
        state = "finalizing"
        finalizing = true
        updateNotification()
        finalizeOnWorker(discard = discardRequested)
    }

    private fun startNewRecording() {
        if (state != "idle") return
        requestAudioFocus()
        recordingId = UUID.randomUUID().toString()
        nextSegmentIndex = 0
        interruptionReason = null
        discardRequested = false
        pendingSegments.clear()
        encryptedSegments.clear()
        synchronized(markers) { markers.clear() }
        pausedAtElapsed = 0L
        pausedTotal = 0L
        state = "recording"
        startSegment()
        startedAtElapsed = SystemClock.elapsedRealtime()
        ensureForeground(
            "正在录音",
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
        handler.removeCallbacks(notificationTicker)
        handler.postDelayed(notificationTicker, 30_000)
        handler.removeCallbacks(segmentTicker)
        handler.postDelayed(segmentTicker, segmentDurationMs)
    }

    private fun requestAudioFocus() {
        val audioManager = getSystemService(AudioManager::class.java)
        focusRequest = AudioFocusRequest.Builder(
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE,
        ).setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        ).setOnAudioFocusChangeListener { change ->
            if (
                change == AudioManager.AUDIOFOCUS_LOSS ||
                change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
            ) {
                handler.post {
                    finishRecording(
                        discard = false,
                        reason = "来电或其他App占用麦克风",
                    )
                }
            }
        }.build()
        if (
            audioManager.requestAudioFocus(focusRequest!!) !=
            AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        ) {
            focusRequest = null
            throw IllegalStateException("麦克风当前被其他App占用")
        }
    }

    private fun startSegment() {
        val directory = File(
            filesDir,
            "mobile-recordings/${recordingId ?: error("录音标识缺失")}",
        ).apply { mkdirs() }
        val index = nextSegmentIndex++
        val segmentId = UUID.randomUUID().toString()
        val file = File(directory, "$segmentId.aac")
        recorder = MediaRecorder(this).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioEncodingBitRate(128_000)
            setAudioSamplingRate(44_100)
            setOutputFile(file.absolutePath)
            setOnErrorListener(this@RecordingService)
            prepare()
            start()
        }
        currentSegment = PendingSegment(index, segmentId, file.absolutePath)
        persistJournal()
    }

    private fun rotateSegment() {
        if (state != "recording" || recorder == null) return
        val gapStartedAt = SystemClock.elapsedRealtime()
        val stopped = stopCurrentSegment("录音分段失败")
        if (stopped == null) {
            currentSegment = null
            persistJournal()
            finishRecording(
                discard = false,
                reason = interruptionReason ?: "录音分段失败",
            )
            return
        }
        pendingSegments += stopped
        currentSegment = null
        persistJournal()
        try {
            startSegment()
            pausedTotal += SystemClock.elapsedRealtime() - gapStartedAt
        } catch (error: Exception) {
            interruptionReason = error.message ?: "录音分段后无法继续"
            finishRecording(discard = false, reason = interruptionReason)
            return
        }
        executor.execute { secureSegmentAndCheckpointSafely(stopped) }
    }

    private fun stopCurrentSegment(reason: String): PendingSegment? {
        val segment = currentSegment
        val activeRecorder = recorder
        recorder = null
        var failed = false
        try {
            activeRecorder?.stop()
        } catch (_: Exception) {
            failed = true
        }
        if (runCatching { activeRecorder?.reset() }.isFailure) failed = true
        if (runCatching { activeRecorder?.release() }.isFailure) failed = true
        if (failed && interruptionReason == null) interruptionReason = reason
        val file = segment?.path?.let(::File)
        if (segment == null || file == null || !file.exists() || file.length() <= 0L) {
            file?.delete()
            return null
        }
        return segment
    }

    private fun secureSegmentAndCheckpoint(segment: PendingSegment) {
        val encrypted = secureSegment(segment)
        synchronized(journalLock) {
            pendingSegments.removeAll { it.id == segment.id }
            encryptedSegments.removeAll { it.id == segment.id }
            encryptedSegments += encrypted
            persistJournalLocked()
        }
    }

    private fun secureSegmentAndCheckpointSafely(segment: PendingSegment) {
        try {
            secureSegmentAndCheckpoint(segment)
        } catch (_: Exception) {
            // Journal keeps the clear/encrypted candidate for final recovery.
        }
    }

    private fun secureSegment(segment: PendingSegment): EncryptedSegment {
        val clearFile = File(segment.path)
        val encryptedFile = File(clearFile.parentFile, "${segment.id}.lyenc")
        val store = EncryptedAttachmentStore(applicationContext)
        if (clearFile.exists() && clearFile.length() > 0L) {
            val size = clearFile.length()
            val sha = sha256(clearFile)
            val encrypted = store.encrypt(
                clearFile,
                segment.id,
                deleteSource = true,
            )
            return EncryptedSegment(
                segment.index,
                segment.id,
                encrypted.file.absolutePath,
                size,
                sha,
            )
        }
        if (!encryptedFile.exists()) {
            throw IllegalStateException("录音分段原件不存在")
        }
        val size = store.clearSize(encryptedFile)
        val digest = MessageDigest.getInstance("SHA-256")
        val count = (
            (size + EncryptedAttachmentStore.clearChunkBytes - 1) /
                EncryptedAttachmentStore.clearChunkBytes
            ).toInt()
        for (chunk in 0 until count) {
            digest.update(store.readChunk(encryptedFile, segment.id, chunk))
        }
        return EncryptedSegment(
            segment.index,
            segment.id,
            encryptedFile.absolutePath,
            size,
            digest.digest().joinToString("") { "%02x".format(it) },
        )
    }

    private fun pauseRecording() {
        if (state != "recording") return
        val stopped = stopCurrentSegment("暂停录音时分段失败")
        currentSegment = null
        if (stopped == null) {
            persistJournal()
            finishRecording(
                discard = false,
                reason = interruptionReason ?: "暂停录音时分段失败",
            )
            return
        }
        pendingSegments += stopped
        pausedAtElapsed = SystemClock.elapsedRealtime()
        state = "paused"
        persistJournal()
        handler.removeCallbacks(segmentTicker)
        executor.execute { secureSegmentAndCheckpointSafely(stopped) }
        updateNotification()
    }

    private fun resumeRecording() {
        if (state != "paused") return
        pausedTotal += SystemClock.elapsedRealtime() - pausedAtElapsed
        pausedAtElapsed = 0L
        state = "recording"
        val gapStartedAt = SystemClock.elapsedRealtime()
        startSegment()
        pausedTotal += SystemClock.elapsedRealtime() - gapStartedAt
        handler.removeCallbacks(segmentTicker)
        handler.postDelayed(segmentTicker, segmentDurationMs)
        updateNotification()
    }

    private fun markRecording() {
        if (state != "recording" && state != "paused") return
        val duration = snapshot()["durationMs"] as Long
        synchronized(markers) { markers.add(duration) }
        persistJournal()
        updateNotification()
    }

    private fun finishRecording(discard: Boolean, reason: String?) {
        if (finalizing || (state != "recording" && state != "paused")) return
        discardRequested = discard
        if (reason != null) interruptionReason = reason
        val discardIntentDurable = !discard || runCatching {
            // Persist user intent before releasing the recorder. If the process
            // stops at any later point, recovery must never save a discarded
            // recording.
            persistJournal()
        }.isSuccess
        stopCurrentSegment("录音异常中断")?.let { pendingSegments += it }
        currentSegment = null
        val stoppedJournalDurable = runCatching { persistJournal() }.isSuccess
        abandonAudioFocus()
        finalizing = true
        state = "finalizing"
        handler.removeCallbacks(segmentTicker)
        handler.removeCallbacks(notificationTicker)
        ensureForeground(
            if (discard) "正在放弃录音…" else "正在安全保存录音…",
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        if (discard && !discardIntentDurable && !stoppedJournalDurable) {
            var error: String? = null
            try {
                deleteRecordingDirectory()
                clearJournal()
            } catch (failure: Exception) {
                error = failure.message ?: "录音放弃未完成"
            }
            handler.post { finishFinalization(error, discarded = true) }
            return
        }
        finalizeOnWorker(discard)
    }

    private fun finalizeOnWorker(discard: Boolean) {
        executor.execute {
            var error: String? = null
            try {
                if (discard) {
                    deleteRecordingDirectory()
                    clearJournal()
                } else {
                    val pending = synchronized(journalLock) {
                        pendingSegments.toList()
                    }
                    for (segment in pending) {
                        secureSegmentAndCheckpoint(segment)
                    }
                    val secured = synchronized(journalLock) {
                        if (pendingSegments.isNotEmpty()) {
                            throw IllegalStateException(
                                "仍有录音分段尚未安全加密",
                            )
                        }
                        encryptedSegments.sortedBy { it.index }.toList()
                    }
                    val id = recordingId
                        ?: throw IllegalStateException("录音标识缺失")
                    if (secured.isEmpty()) {
                        deleteRecordingDirectory()
                        clearJournal()
                        throw IllegalStateException("录音过短，没有有效内容")
                    }
                    val savedMarkers = synchronized(markers) { markers.toList() }
                    val captured = ShareIntakeStore(applicationContext)
                        .captureEncryptedFiles(
                            files = secured.map { segment ->
                                ShareIntakeStore.EncryptedPrivateFile(
                                    attachmentId = segment.id,
                                    file = File(segment.path),
                                    name = "灵感录音-${(segment.index + 1).toString().padStart(3, '0')}.aac",
                                    mimeType = "audio/aac",
                                    clearSize = segment.clearSize,
                                    sha256 = segment.sha256,
                                )
                            },
                            sourceApp = "LY快速记录录音",
                            recordingMarkersMs = savedMarkers,
                            recordingInterruptionReason = interruptionReason,
                            shareId = "recording-$id",
                        )
                    if (captured.error != null) {
                        throw IllegalStateException(captured.error)
                    }
                    BackgroundSyncScheduler.enqueue(applicationContext)
                    clearJournal()
                }
            } catch (failure: Exception) {
                error = failure.message ?: "录音安全保存未完成"
            }
            handler.post { finishFinalization(error, discard) }
        }
    }

    private fun finishFinalization(error: String?, discarded: Boolean) {
        val restart = pendingStartAfterRecovery && error == null
        pendingStartAfterRecovery = false
        finalizing = false
        state = "idle"
        currentSegment = null
        pendingSegments.clear()
        encryptedSegments.clear()
        recordingId = null
        discardRequested = false
        synchronized(markers) { markers.clear() }
        if (error == null) {
            getSystemService(NotificationManager::class.java).notify(
                notificationId,
                terminalNotification(
                    if (discarded) "录音已放弃" else "录音已安全保存",
                ),
            )
        } else {
            showTerminalNotification(
                if (hasInterruptedRecording(applicationContext)) {
                    "$error，下次打开会继续恢复"
                } else {
                    error
                },
            )
        }
        stopForeground(STOP_FOREGROUND_DETACH)
        sendBroadcast(Intent("ly.creator.import.CHANGED").setPackage(packageName))
        notifyChanged()
        if (restart) startNewRecording() else stopSelf()
    }

    private fun restoreJournal(journal: Journal) {
        recordingId = journal.recordingId
        nextSegmentIndex = journal.nextSegmentIndex
        currentSegment = journal.current
        pendingSegments.clear()
        pendingSegments += journal.pending
        encryptedSegments.clear()
        encryptedSegments += journal.encrypted
        interruptionReason = journal.interruptionReason
        discardRequested = journal.discardRequested
        synchronized(markers) {
            markers.clear()
            markers += journal.markersMs
        }
    }

    private fun deleteRecordingDirectory() {
        val id = recordingId ?: throw IllegalStateException("录音标识缺失")
        val directory = File(filesDir, "mobile-recordings/$id")
        if (
            directory.exists() &&
            (!directory.deleteRecursively() || directory.exists())
        ) {
            throw IllegalStateException("录音原件尚未全部删除")
        }
    }

    private fun persistJournal() = synchronized(journalLock) {
        persistJournalLocked()
    }

    private fun persistJournalLocked() {
        val id = recordingId ?: return
        val payload = JSONObject().apply {
            put("recordingId", id)
            put("nextSegmentIndex", nextSegmentIndex)
            put("current", currentSegment?.let(::pendingJson))
            put("pending", JSONArray(pendingSegments.map(::pendingJson)))
            put("encrypted", JSONArray(encryptedSegments.map(::encryptedJson)))
            put("markersMs", JSONArray(synchronized(markers) { markers.toList() }))
            put("interruptionReason", interruptionReason)
            put("discardRequested", discardRequested)
        }
        val encrypted = secureValues.encrypt(payload.toString())
        val saved = getSharedPreferences(journalName, MODE_PRIVATE)
            .edit()
            .putString(journalPayload, encrypted)
            .commit()
        if (!saved) throw IllegalStateException("无法保存录音恢复信息")
    }

    private fun loadJournal(): Journal? {
        val encrypted = getSharedPreferences(journalName, MODE_PRIVATE)
            .getString(journalPayload, null)
            ?: return null
        val value = JSONObject(secureValues.decrypt(encrypted))
        fun pending(item: JSONObject) = PendingSegment(
            item.getInt("index"),
            item.getString("id"),
            item.getString("path"),
        )
        fun encryptedSegment(item: JSONObject) = EncryptedSegment(
            item.getInt("index"),
            item.getString("id"),
            item.getString("path"),
            item.getLong("clearSize"),
            item.getString("sha256"),
        )
        val pendingArray = value.optJSONArray("pending") ?: JSONArray()
        val encryptedArray = value.optJSONArray("encrypted") ?: JSONArray()
        val markerArray = value.optJSONArray("markersMs") ?: JSONArray()
        return Journal(
            recordingId = value.getString("recordingId"),
            nextSegmentIndex = value.getInt("nextSegmentIndex"),
            current = value.optJSONObject("current")?.let(::pending),
            pending = (0 until pendingArray.length()).map {
                pending(pendingArray.getJSONObject(it))
            },
            encrypted = (0 until encryptedArray.length()).map {
                encryptedSegment(encryptedArray.getJSONObject(it))
            },
            markersMs = (0 until markerArray.length()).map {
                markerArray.getLong(it)
            },
            interruptionReason = value.optString(
                "interruptionReason",
                "",
            ).takeIf { it.isNotEmpty() },
            discardRequested = value.optBoolean("discardRequested", false),
        )
    }

    private fun pendingJson(segment: PendingSegment) = JSONObject().apply {
        put("index", segment.index)
        put("id", segment.id)
        put("path", segment.path)
    }

    private fun encryptedJson(segment: EncryptedSegment) = JSONObject().apply {
        put("index", segment.index)
        put("id", segment.id)
        put("path", segment.path)
        put("clearSize", segment.clearSize)
        put("sha256", segment.sha256)
    }

    private fun clearJournal() {
        val removed = getSharedPreferences(journalName, MODE_PRIVATE)
            .edit()
            .remove(journalPayload)
            .commit()
        if (!removed) throw IllegalStateException("录音恢复信息清理失败")
    }

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

    private fun abandonAudioFocus() {
        focusRequest?.let {
            getSystemService(AudioManager::class.java)
                .abandonAudioFocusRequest(it)
        }
        focusRequest = null
    }

    private fun ensureForeground(text: String, type: Int) {
        ServiceCompat.startForeground(
            this,
            notificationId,
            notification(text),
            type,
        )
    }

    private fun notification(overrideText: String? = null): Notification {
        val snapshot = snapshot()
        val paused = snapshot["state"] == "paused"
        val duration = snapshot["durationMs"] as Long
        val minutes = duration / 60_000
        val seconds = (duration / 1_000) % 60
        val content = overrideText ?: if (state == "finalizing") {
            "正在安全保存录音…"
        } else if (duration >= 60 * 60_000) {
            "已录音超过1小时·%02d:%02d".format(minutes, seconds)
        } else {
            "%s·%02d:%02d".format(
                if (paused) "已暂停" else "正在录音",
                minutes,
                seconds,
            )
        }
        val builder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("LY灵感录音")
            .setContentText(content)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        if (state == "recording" || state == "paused") {
            builder
                .addAction(
                    0,
                    if (paused) "继续" else "暂停",
                    serviceAction(if (paused) actionResume else actionPause, 1),
                )
                .addAction(0, "标记重点", serviceAction(actionMark, 2))
                .addAction(0, "结束并保存", serviceAction(actionStop, 3))
        }
        return builder.build()
    }

    private fun terminalNotification(text: String): Notification =
        NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("LY灵感录音")
            .setContentText(text)
            .setContentIntent(openAppIntent())
            .setAutoCancel(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        packageManager.getLaunchIntentForPackage(packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun serviceAction(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            this,
            requestCode,
            Intent(this, RecordingService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(
            notificationId,
            notification(),
        )
        notifyChanged()
    }

    private fun showTerminalNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(
            notificationId,
            terminalNotification(text),
        )
    }

    private fun notifyChanged() {
        sendBroadcast(Intent(broadcastChanged).setPackage(packageName))
        val active = state == "recording" || state == "paused" || state == "finalizing"
        CaptureWidgetProvider.updateRecording(this, active)
        RecordTileService.refresh(this)
    }

    override fun onError(mr: MediaRecorder?, what: Int, extra: Int) {
        handler.post {
            finishRecording(
                discard = false,
                reason = "麦克风或系统异常中断($what/$extra)",
            )
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The foreground service continues after the task card is dismissed.
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(segmentTicker)
        handler.removeCallbacks(notificationTicker)
        if (state == "recording" || state == "paused") {
            interruptionReason = "录音服务被系统结束"
            stopCurrentSegment("录音服务被系统结束")
                ?.let { pendingSegments += it }
            currentSegment = null
            runCatching { persistJournal() }
        }
        abandonAudioFocus()
        recorder?.release()
        recorder = null
        state = "idle"
        CaptureWidgetProvider.updateRecording(this, false)
        RecordTileService.refresh(this)
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
