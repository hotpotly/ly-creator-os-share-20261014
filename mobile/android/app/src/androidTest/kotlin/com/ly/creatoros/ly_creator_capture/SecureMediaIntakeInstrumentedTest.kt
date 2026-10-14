package com.ly.creatoros.ly_creator_capture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ly.creatoros.secure_attachment_storage.EncryptedAttachmentStore
import com.ly.creatoros.secure_attachment_storage.SecureValueStore
import com.ly.creatoros.secure_attachment_storage.ShareQueueBridge
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SecureMediaIntakeInstrumentedTest {
    private lateinit var context: Context
    private lateinit var root: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearNativeQueue()
        root = File(context.filesDir, "mobile-camera/instrumented-${UUID.randomUUID()}")
            .apply { mkdirs() }
    }

    @After
    fun tearDown() {
        clearNativeQueue()
        root.deleteRecursively()
    }

    @Test
    fun encryptedStoreStreamsMultipleChunksAndRejectsCorruption() {
        val source = File(root, "private-original-name.bin")
        val bytes = ByteArray(EncryptedAttachmentStore.clearChunkBytes * 2 + 137) {
            (it % 251).toByte()
        }
        source.writeBytes(bytes)
        val attachmentId = UUID.randomUUID().toString()
        val store = EncryptedAttachmentStore(context)

        val encrypted = store.encrypt(source, attachmentId, deleteSource = true)

        assertFalse(source.exists())
        assertEquals("$attachmentId.lyenc", encrypted.file.name)
        assertEquals(bytes.size.toLong(), store.clearSize(encrypted.file))
        val restored = buildList {
            for (index in 0..2) addAll(store.readChunk(encrypted.file, attachmentId, index).toList())
        }.toByteArray()
        assertArrayEquals(bytes, restored)

        val corrupted = encrypted.file.readBytes()
        corrupted[corrupted.lastIndex] = (corrupted.last().toInt() xor 1).toByte()
        encrypted.file.writeBytes(corrupted)
        assertThrows(Exception::class.java) {
            store.readChunk(encrypted.file, attachmentId, 2)
        }
    }

    @Test
    fun durableQueueRecoversOnceAndDeletesOnlyItsTemporaryPlaintext() {
        val queue = ShareQueueBridge(context)
        val shareId = "instrumented-job-${UUID.randomUUID()}"
        val temporaryPlaintext = File(root, "temporary-clear.bin").apply {
            writeBytes(byteArrayOf(1, 2, 3))
        }
        val value = linkedMapOf<String, Any?>(
            "shareId" to shareId,
            "content" to "进程中断后恢复",
            "createdAt" to "2026-07-25T00:00:00.000Z",
            "attachments" to emptyList<Map<String, Any?>>(),
        )

        queue.writeDurableJob(shareId, value, listOf(temporaryPlaintext.absolutePath))
        val recovered = ShareQueueBridge(context).listPending()

        assertFalse(temporaryPlaintext.exists())
        assertEquals(listOf(shareId), recovered.map { it["shareId"] })
        assertEquals(1, ShareQueueBridge(context).listPending().size)
        queue.acknowledge(shareId)
        assertTrue(queue.listPending().isEmpty())
        assertTrue(queue.isCompleted(shareId))
    }

    @Test
    fun multipleSystemSharePreservesOrderAndPrivateBytesAfterUriUse() {
        val first = File(root, "一号资料.pdf").apply {
            writeBytes("%PDF-private-one".toByteArray())
        }
        val second = File(root, "二号资料.docx").apply {
            writeBytes("word-private-two".toByteArray())
        }
        val uris = arrayListOf(
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                first,
            ),
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                second,
            ),
        )
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val shareId = "instrumented-multiple-${UUID.randomUUID()}"
        val intake = ShareIntakeStore(context)

        val captured = intake.captureIntent(
            intent,
            persist = true,
            sourceApp = "instrumented.share",
            shareId = shareId,
        )

        assertNull(captured.error)
        val attachments = captured.value?.get("attachments") as List<*>
        assertEquals(listOf(first.name, second.name), attachments.map {
            (it as Map<*, *>)["name"]
        })
        val expectedBytes = listOf(first.readBytes(), second.readBytes())
        attachments.forEachIndexed { index, raw ->
            val attachment = raw as Map<*, *>
            val encryptedFile = File(attachment["localPath"] as String)
            assertTrue(encryptedFile.name.matches(Regex("""[0-9a-f-]{36}\.lyenc""")))
            assertArrayEquals(
                expectedBytes[index],
                readEncrypted(
                    encryptedFile,
                    attachment["attachmentId"] as String,
                    (attachment["sizeBytes"] as Number).toLong(),
                ),
            )
        }
        val repeated = intake.captureIntent(
            intent,
            persist = true,
            sourceApp = "instrumented.share",
            shareId = shareId,
        )
        assertNull(repeated.error)
        assertEquals(1, intake.listPending().count { it["shareId"] == shareId })
        val privateDirectory = File(
            context.filesDir,
            "mobile-attachment-intake/$shareId",
        )
        assertTrue(
            privateDirectory.listFiles().orEmpty().none {
                it.isFile &&
                    !it.name.endsWith(".lyenc") &&
                    it.name != ".import-complete"
            },
        )
    }

    @Test
    fun jpegImportRemovesDeviceAndGpsButKeepsOrientationAndCaptureTime() {
        val source = File(root, "camera-private-name.jpg")
        source.outputStream().use {
            Bitmap.createBitmap(20, 12, Bitmap.Config.ARGB_8888)
                .compress(Bitmap.CompressFormat.JPEG, 95, it)
        }
        ExifInterface(source).apply {
            setLatLong(31.2304, 121.4737)
            setAttribute(ExifInterface.TAG_MAKE, "PrivateMaker")
            setAttribute(ExifInterface.TAG_MODEL, "PrivateModel")
            setAttribute(ExifInterface.TAG_SOFTWARE, "PrivateSoftware")
            setAttribute(ExifInterface.TAG_IMAGE_UNIQUE_ID, "private-id")
            setAttribute(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_ROTATE_90.toString(),
            )
            setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, "2026:07:25 12:34:56")
            saveAttributes()
        }

        val captured = ShareIntakeStore(context).capturePrivateFile(
            file = source,
            name = source.name,
            mimeType = "image/jpeg",
            persist = true,
            sourceApp = "LY快速记录相机",
        )

        assertNull(captured.error)
        assertFalse(source.exists())
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        val clearBytes = readEncrypted(
            File(attachment["localPath"] as String),
            attachment["attachmentId"] as String,
            (attachment["sizeBytes"] as Number).toLong(),
        )
        val restored = File(root, "restored.jpg").apply { writeBytes(clearBytes) }
        val exif = ExifInterface(restored)
        assertNull(exif.latLong)
        assertNull(exif.getAttribute(ExifInterface.TAG_MAKE))
        assertNull(exif.getAttribute(ExifInterface.TAG_MODEL))
        assertNull(exif.getAttribute(ExifInterface.TAG_SOFTWARE))
        assertNull(exif.getAttribute(ExifInterface.TAG_IMAGE_UNIQUE_ID))
        assertEquals(
            ExifInterface.ORIENTATION_ROTATE_90,
            exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_UNDEFINED,
            ),
        )
        assertEquals(
            "2026:07:25 12:34:56",
            exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL),
        )
        assertEquals(sha256(clearBytes), attachment["sha256"])
        val previewPath = attachment["previewLocalPath"] as String
        val previewId = attachment["previewAttachmentId"] as String
        val previewBytes = readEncrypted(
            File(previewPath),
            previewId,
            EncryptedAttachmentStore(context).clearSize(
                File(previewPath),
            ),
        )
        val previewBitmap = android.graphics.BitmapFactory.decodeByteArray(
            previewBytes,
            0,
            previewBytes.size,
        )
        assertTrue(previewBitmap.height > previewBitmap.width)
        previewBitmap.recycle()
    }

    @Test
    fun gifImportDoesNotRequireExifSupport() {
        val source = File(root, "animated.gif").apply {
            val base = java.util.Base64.getDecoder().decode(
                "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            )
            val xmp = byteArrayOf(0x21, 0xff.toByte(), 0x0b) +
                "XMP DataXMP".toByteArray(Charsets.ISO_8859_1) +
                byteArrayOf(0x03, 'G'.code.toByte(), 'P'.code.toByte(), 'S'.code.toByte(), 0x00)
            writeBytes(base.copyOfRange(0, 19) + xmp + base.copyOfRange(19, base.size))
        }
        val captured = ShareIntakeStore(context).capturePrivateFile(
            file = source,
            name = source.name,
            mimeType = "image/gif",
            persist = true,
            sourceApp = "instrumented.gif",
        )
        assertNull(captured.error)
        assertFalse(source.exists())
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        assertEquals("image/gif", attachment["mimeType"])
        val encryptedFile = File(attachment["localPath"] as String)
        val clear = readEncrypted(
            encryptedFile,
            attachment["attachmentId"] as String,
            (attachment["sizeBytes"] as Number).toLong(),
        )
        assertFalse(String(clear, Charsets.ISO_8859_1).contains("XMP DataXMP"))
        assertFalse(String(clear, Charsets.ISO_8859_1).contains("GPS"))
    }

    @Test
    fun svgImportStripsMetadataCommentsAndPrivacyAttributes() {
        val source = File(root, "private.svg").apply {
            writeText(
                """
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"
                     data-camera-model="PrivatePhone">
                  <!-- GPS 31.2,121.4 -->
                  <metadata><device>PrivatePhone</device><location>Shanghai</location></metadata>
                  <rect width="20" height="10" fill="#70845f"/>
                </svg>
                """.trimIndent(),
            )
        }
        val captured = ShareIntakeStore(context).capturePrivateFile(
            file = source,
            name = source.name,
            mimeType = "image/svg+xml",
            persist = true,
            sourceApp = "instrumented.svg",
        )

        assertNull(captured.error)
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        val clear = readEncrypted(
            File(attachment["localPath"] as String),
            attachment["attachmentId"] as String,
            (attachment["sizeBytes"] as Number).toLong(),
        ).toString(Charsets.UTF_8)
        assertFalse(clear.contains("PrivatePhone"))
        assertFalse(clear.contains("Shanghai"))
        assertFalse(clear.contains("GPS"))
        assertFalse(clear.contains("data-camera-model"))
        assertTrue(clear.contains("<rect"))
    }

    @Test
    fun svgImportRejectsDoctypeAndExternalEntities() {
        val secret = File(root, "must-not-be-read.txt").apply {
            writeText("PRIVATE-XXE-CONTENT")
        }
        val source = File(root, "malicious.svg").apply {
            writeText(
                """
                <?xml version="1.0"?>
                <!DOCTYPE svg [
                  <!ENTITY xxe SYSTEM "${secret.toURI()}">
                ]>
                <svg xmlns="http://www.w3.org/2000/svg">
                  <text>&xxe;</text>
                </svg>
                """.trimIndent(),
            )
        }

        val captured = ShareIntakeStore(context).capturePrivateFile(
            file = source,
            name = source.name,
            mimeType = "image/svg+xml",
            persist = true,
            sourceApp = "instrumented.svg",
        )

        assertTrue(captured.error != null)
        assertTrue(
            ShareIntakeStore(context).listPending().none {
                it["sourceApp"] == "instrumented.svg"
            },
        )
    }

    @Test
    fun octetStreamJpegWithoutExtensionStillScrubsExif() {
        val source = File(root, "opaque")
        source.outputStream().use {
            Bitmap.createBitmap(8, 6, Bitmap.Config.ARGB_8888)
                .compress(Bitmap.CompressFormat.JPEG, 90, it)
        }
        ExifInterface(source).apply {
            setLatLong(22.5431, 114.0579)
            setAttribute(ExifInterface.TAG_MODEL, "SecretModel")
            saveAttributes()
        }
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            source,
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val captured = ShareIntakeStore(context).captureIntent(
            intent,
            persist = true,
            shareId = "octet-jpeg-${UUID.randomUUID()}",
        )
        assertNull(captured.error)
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        assertEquals("image/jpeg", attachment["mimeType"])
        val clear = readEncrypted(
            File(attachment["localPath"] as String),
            attachment["attachmentId"] as String,
            (attachment["sizeBytes"] as Number).toLong(),
        )
        val restored = File(root, "octet-restored").apply {
            writeBytes(clear)
        }
        assertNull(ExifInterface(restored).latLong)
        assertNull(
            ExifInterface(restored).getAttribute(ExifInterface.TAG_MODEL),
        )
    }

    @Test
    fun m4aIsoContainerStaysAudioAndKeepsOriginalBytes() {
        val source = File(root, "voice-note.m4a")
        val bytes = byteArrayOf(
            0x00,
            0x00,
            0x00,
            0x18,
            'f'.code.toByte(),
            't'.code.toByte(),
            'y'.code.toByte(),
            'p'.code.toByte(),
            'M'.code.toByte(),
            '4'.code.toByte(),
            'A'.code.toByte(),
            0x20,
            0x00,
            0x00,
            0x00,
            0x00,
            'i'.code.toByte(),
            's'.code.toByte(),
            'o'.code.toByte(),
            'm'.code.toByte(),
            1,
            2,
            3,
            4,
        )
        source.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            source,
        )
        val captured = ShareIntakeStore(context).captureIntent(
            Intent(Intent.ACTION_SEND).apply {
                type = "audio/mp4"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            persist = true,
            shareId = "m4a-${UUID.randomUUID()}",
        )

        assertNull(captured.error)
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        assertTrue((attachment["mimeType"] as String).startsWith("audio/"))
        assertEquals("voice-note.m4a", attachment["name"])
        assertArrayEquals(
            bytes,
            readEncrypted(
                File(attachment["localPath"] as String),
                attachment["attachmentId"] as String,
                (attachment["sizeBytes"] as Number).toLong(),
            ),
        )
    }

    @Test
    fun oversizedSharedTextKeepsFullTextInEncryptedAttachment() {
        val original = "长".repeat(100_100)
        val captured = ShareIntakeStore(context).captureIntent(
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, original)
            },
            persist = true,
            shareId = "long-text-${UUID.randomUUID()}",
        )

        assertNull(captured.error)
        val content = captured.value?.get("content") as String
        assertTrue(content.length <= 100_000)
        assertTrue(content.endsWith("【分享全文已安全保存为附件】"))
        val attachment = (
            captured.value?.get("attachments") as List<*>
            ).single() as Map<*, *>
        assertEquals("分享全文.txt", attachment["name"])
        assertEquals("text/plain", attachment["mimeType"])
        val clear = readEncrypted(
            File(attachment["localPath"] as String),
            attachment["attachmentId"] as String,
            (attachment["sizeBytes"] as Number).toLong(),
        )
        assertEquals(original, clear.toString(Charsets.UTF_8))
    }

    @Test
    fun perAttachmentCheckpointDoesNotReopenCompletedTemporaryUri() {
        val first = File(root, "first.pdf").apply {
            writeBytes("%PDF-first-once".toByteArray())
        }
        val second = File(root, "second.pdf")
        val firstUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            first,
        )
        val secondUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            second,
        )
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "application/pdf"
            putParcelableArrayListExtra(
                Intent.EXTRA_STREAM,
                arrayListOf(firstUri, secondUri),
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val shareId = "checkpoint-${UUID.randomUUID()}"
        val intake = ShareIntakeStore(context)
        val interrupted = intake.captureIntent(
            intent,
            persist = true,
            shareId = shareId,
        )
        assertTrue(interrupted.error != null)
        first.delete()
        second.writeBytes("%PDF-second-later".toByteArray())

        val resumed = intake.captureIntent(
            intent,
            persist = true,
            shareId = shareId,
        )
        assertNull(resumed.error)
        val attachments = resumed.value?.get("attachments") as List<*>
        assertEquals(2, attachments.size)
        assertEquals(
            listOf("first.pdf", "second.pdf"),
            attachments.map { (it as Map<*, *>)["name"] },
        )
    }

    @Test
    fun terminalImportFailureDeletesInvisibleCheckpointCiphertext() {
        val first = File(root, "large-first.pdf").apply {
            writeBytes(ByteArray(128 * 1024) { 9 })
        }
        val missing = File(root, "missing-second.pdf")
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "application/pdf"
            putParcelableArrayListExtra(
                Intent.EXTRA_STREAM,
                arrayListOf(
                    FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        first,
                    ),
                    FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        missing,
                    ),
                ),
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val shareId = "terminal-failure-${UUID.randomUUID()}"
        val intake = ShareIntakeStore(context)

        val failed = intake.captureIntent(
            intent,
            persist = true,
            shareId = shareId,
        )
        assertTrue(failed.error != null)
        val privateDirectory = File(
            context.filesDir,
            "mobile-attachment-intake/$shareId",
        )
        assertTrue(
            privateDirectory.listFiles().orEmpty().any {
                it.name.endsWith(".lyenc")
            },
        )

        intake.discardIncompleteImport(shareId)

        assertFalse(privateDirectory.exists())
    }

    @Test
    fun interruptedRecordingJournalRecoversEncryptedSegmentsAsOneCapture() {
        val recordingId = UUID.randomUUID().toString()
        val attachmentId = UUID.randomUUID().toString()
        val directory = File(context.filesDir, "mobile-recordings/$recordingId")
            .apply { mkdirs() }
        val clearBytes = ByteArray(4_097) { (it % 127).toByte() }
        val encrypted = EncryptedAttachmentStore(context).encrypt(
            File(directory, "$attachmentId.aac").apply {
                writeBytes(clearBytes)
            },
            attachmentId,
            deleteSource = true,
        )
        val journal = JSONObject().apply {
            put("recordingId", recordingId)
            put("nextSegmentIndex", 1)
            put("current", JSONObject.NULL)
            put("pending", JSONArray())
            put(
                "encrypted",
                JSONArray().put(
                    JSONObject().apply {
                        put("index", 0)
                        put("id", attachmentId)
                        put("path", encrypted.file.absolutePath)
                        put("clearSize", clearBytes.size)
                        put("sha256", sha256(clearBytes))
                    },
                ),
            )
            put("markersMs", JSONArray().put(1_234))
            put("interruptionReason", JSONObject.NULL)
        }
        context.getSharedPreferences("ly_recording_journal", Context.MODE_PRIVATE)
            .edit()
            .putString(
                "encrypted_payload_v2",
                SecureValueStore().encrypt(journal.toString()),
            )
            .commit()
        assertTrue(RecordingService.hasInterruptedRecording(context))

        context.startForegroundService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionRecover),
        )

        val deadline = System.currentTimeMillis() + 15_000
        var recovered: Map<String, Any?>? = null
        while (System.currentTimeMillis() < deadline) {
            recovered = ShareIntakeStore(context).listPending()
                .firstOrNull { it["shareId"] == "recording-$recordingId" }
            if (recovered != null &&
                !RecordingService.hasInterruptedRecording(context)
            ) {
                break
            }
            Thread.sleep(100)
        }
        assertFalse(RecordingService.hasInterruptedRecording(context))
        val recoveredValue = requireNotNull(recovered)
        assertEquals(
            listOf(1_234L),
            (recoveredValue["recordingMarkersMs"] as List<*>)
                .map { (it as Number).toLong() },
        )
        assertEquals(
            "录音进程异常中断",
            recoveredValue["recordingInterruptionReason"],
        )
        val attachment = (recoveredValue["attachments"] as List<*>)
            .single() as Map<*, *>
        assertArrayEquals(
            clearBytes,
            readEncrypted(
                File(attachment["localPath"] as String),
                attachment["attachmentId"] as String,
                (attachment["sizeBytes"] as Number).toLong(),
            ),
        )
    }

    @Test
    fun interruptedDiscardDeletesAudioAndNeverCreatesCapture() {
        val recordingId = UUID.randomUUID().toString()
        val attachmentId = UUID.randomUUID().toString()
        val directory = File(context.filesDir, "mobile-recordings/$recordingId")
            .apply { mkdirs() }
        val encrypted = EncryptedAttachmentStore(context).encrypt(
            File(directory, "$attachmentId.aac").apply {
                writeBytes(ByteArray(512) { 7 })
            },
            attachmentId,
            deleteSource = true,
        )
        val journal = JSONObject().apply {
            put("recordingId", recordingId)
            put("nextSegmentIndex", 1)
            put("current", JSONObject.NULL)
            put("pending", JSONArray())
            put(
                "encrypted",
                JSONArray().put(
                    JSONObject().apply {
                        put("index", 0)
                        put("id", attachmentId)
                        put("path", encrypted.file.absolutePath)
                        put("clearSize", 512)
                        put("sha256", sha256(ByteArray(512) { 7 }))
                    },
                ),
            )
            put("markersMs", JSONArray())
            put("interruptionReason", JSONObject.NULL)
            put("discardRequested", true)
        }
        context.getSharedPreferences("ly_recording_journal", Context.MODE_PRIVATE)
            .edit()
            .putString(
                "encrypted_payload_v2",
                SecureValueStore().encrypt(journal.toString()),
            )
            .commit()

        context.startForegroundService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionRecover),
        )
        val deadline = System.currentTimeMillis() + 10_000
        while (
            (
                RecordingService.hasInterruptedRecording(context) ||
                    RecordingService.snapshot()["state"] != "idle"
                ) &&
            System.currentTimeMillis() < deadline
        ) {
            Thread.sleep(50)
        }

        assertFalse(RecordingService.hasInterruptedRecording(context))
        assertFalse(directory.exists())
        assertTrue(
            ShareIntakeStore(context).listPending().none {
                it["shareId"] == "recording-$recordingId"
            },
        )
    }

    @Test
    fun emptyInterruptedRecordingClearsJournalWithoutRecoveryLoop() {
        val recordingId = UUID.randomUUID().toString()
        val journal = JSONObject().apply {
            put("recordingId", recordingId)
            put("nextSegmentIndex", 0)
            put("current", JSONObject.NULL)
            put("pending", JSONArray())
            put("encrypted", JSONArray())
            put("markersMs", JSONArray())
            put("interruptionReason", JSONObject.NULL)
            put("discardRequested", false)
        }
        context.getSharedPreferences("ly_recording_journal", Context.MODE_PRIVATE)
            .edit()
            .putString(
                "encrypted_payload_v2",
                SecureValueStore().encrypt(journal.toString()),
            )
            .commit()

        context.startForegroundService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionRecover),
        )
        val deadline = System.currentTimeMillis() + 10_000
        while (
            (
                RecordingService.hasInterruptedRecording(context) ||
                    RecordingService.snapshot()["state"] != "idle"
                ) &&
            System.currentTimeMillis() < deadline
        ) {
            Thread.sleep(50)
        }

        assertFalse(RecordingService.hasInterruptedRecording(context))
        assertTrue(
            ShareIntakeStore(context).listPending().none {
                it["shareId"] == "recording-$recordingId"
            },
        )
    }

    @Test
    fun appRecordingSupportsMarkPauseResumeAndStopToOneDurableCapture() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.RECORD_AUDIO,
        )
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }

        context.startForegroundService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionStart),
        )
        waitForRecordingState("recording")
        Thread.sleep(800)
        context.startService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionMark),
        )
        context.startService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionPause),
        )
        waitForRecordingState("paused")
        Thread.sleep(250)
        context.startService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionResume),
        )
        waitForRecordingState("recording")
        Thread.sleep(800)
        context.startService(
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionStop),
        )

        val deadline = System.currentTimeMillis() + 15_000
        var captured: Map<String, Any?>? = null
        while (System.currentTimeMillis() < deadline) {
            captured = ShareIntakeStore(context).listPending()
                .firstOrNull { it["sourceApp"] == "LY快速记录录音" }
            if (captured != null &&
                RecordingService.snapshot()["state"] == "idle"
            ) {
                break
            }
            Thread.sleep(100)
        }
        val capture = requireNotNull(captured)
        assertEquals(
            1,
            (capture["recordingMarkersMs"] as List<*>).size,
        )
        assertNull(capture["recordingInterruptionReason"])
        val attachments = capture["attachments"] as List<*>
        assertTrue(attachments.isNotEmpty())
        assertTrue(
            attachments.all {
                ((it as Map<*, *>)["sizeBytes"] as Number).toLong() > 0L
            },
        )
    }

    private fun readEncrypted(
        file: File,
        attachmentId: String,
        clearSize: Long,
    ): ByteArray {
        val store = EncryptedAttachmentStore(context)
        val count = (
            (clearSize + EncryptedAttachmentStore.clearChunkBytes - 1) /
                EncryptedAttachmentStore.clearChunkBytes
            ).toInt()
        return buildList {
            for (index in 0 until count) {
                addAll(store.readChunk(file, attachmentId, index).toList())
            }
        }.toByteArray()
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    private fun waitForRecordingState(expected: String) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            if (RecordingService.snapshot()["state"] == expected) return
            Thread.sleep(50)
        }
        throw AssertionError(
            "录音状态未进入$expected，当前为${RecordingService.snapshot()["state"]}",
        )
    }

    private fun clearNativeQueue() {
        if (
            RecordingService.snapshot()["state"] == "recording" ||
            RecordingService.snapshot()["state"] == "paused"
        ) {
            context.startService(
                Intent(context, RecordingService::class.java)
                    .setAction(RecordingService.actionDiscard),
            )
            val deadline = System.currentTimeMillis() + 5_000
            while (
                RecordingService.snapshot()["state"] != "idle" &&
                System.currentTimeMillis() < deadline
            ) {
                Thread.sleep(50)
            }
        }
        context.getSharedPreferences("ly_share_intake", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        File(context.filesDir, "mobile-import-jobs").deleteRecursively()
        File(context.filesDir, "mobile-attachment-intake").deleteRecursively()
        File(context.filesDir, "mobile-recordings").deleteRecursively()
        context.getSharedPreferences("ly_recording_journal", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }
}
