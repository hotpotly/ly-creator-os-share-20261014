package com.ly.creatoros.ly_creator_capture

import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ly.creatoros.secure_attachment_storage.EncryptedAttachmentStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class StageCMaintenanceInstrumentedTest {
    private lateinit var context: Context
    private lateinit var root: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        root = File(context.filesDir, "stage-c-test/${UUID.randomUUID()}")
            .apply { mkdirs() }
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
        context.getSharedPreferences("ly_capture_widget", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @Test
    fun deletePrivateCopiesRemovesEncryptedSourceAndPreviewOnlyInsideApp() {
        val storage = EncryptedAttachmentStore(context)
        val source = File(root, "source-clear.bin").apply {
            writeBytes("source-private".toByteArray())
        }
        val preview = File(root, "preview-clear.bin").apply {
            writeBytes("preview-private".toByteArray())
        }
        val sourceId = UUID.randomUUID().toString()
        val previewId = UUID.randomUUID().toString()
        val encryptedSource = storage.encrypt(source, sourceId, deleteSource = true).file
        val encryptedPreview = storage.encrypt(preview, previewId, deleteSource = true).file

        CaptureMaintenance(context).deletePrivateCopies(
            listOf(
                CaptureMaintenance.Attachment(
                    id = sourceId,
                    path = encryptedSource.absolutePath,
                    name = "资料.bin",
                    mimeType = "application/octet-stream",
                    previewId = previewId,
                    previewPath = encryptedPreview.absolutePath,
                ),
            ),
        )

        assertFalse(encryptedSource.exists())
        assertFalse(encryptedPreview.exists())
        val outside = File(context.cacheDir, "must-not-delete").apply {
            writeText("keep")
        }
        assertThrows(IllegalArgumentException::class.java) {
            CaptureMaintenance(context).deletePrivateCopies(
                listOf(
                    CaptureMaintenance.Attachment(
                        id = sourceId,
                        path = outside.absolutePath,
                        name = outside.name,
                        mimeType = "text/plain",
                        previewId = null,
                        previewPath = null,
                    ),
                ),
            )
        }
        assertTrue(outside.exists())
        outside.delete()
    }

    @Test
    fun widgetAndSystemEntryComponentsAreRegisteredWithoutCloudBackup() {
        CaptureWidgetProvider.updateAll(context, pendingCount = 7, recording = true)
        val widgetState = context.getSharedPreferences(
            "ly_capture_widget",
            Context.MODE_PRIVATE,
        )
        assertEquals(7, widgetState.getInt("pending_count", -1))
        assertTrue(widgetState.getBoolean("recording", false))
        CaptureWidgetProvider.updatePending(context, pendingCount = 2)
        assertEquals(2, widgetState.getInt("pending_count", -1))
        assertTrue(widgetState.getBoolean("recording", false))

        val packageManager = context.packageManager
        packageManager.getServiceInfo(
            ComponentName(context, RecordTileService::class.java),
            PackageManager.ComponentInfoFlags.of(0),
        )
        packageManager.getReceiverInfo(
            ComponentName(context, QuickCaptureReceiver::class.java),
            PackageManager.ComponentInfoFlags.of(0),
        )
        packageManager.getReceiverInfo(
            ComponentName(context, WidgetStatusReceiver::class.java),
            PackageManager.ComponentInfoFlags.of(0),
        )
        packageManager.getReceiverInfo(
            ComponentName(context, CaptureWidgetProvider::class.java),
            PackageManager.ComponentInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
        )
        val application = packageManager.getApplicationInfo(
            context.packageName,
            PackageManager.ApplicationInfoFlags.of(0),
        )
        assertEquals(0, application.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    }

    @Test
    fun shareCleanupSeparatesGenerationHeartbeatFromChooserLease() {
        val batchId = UUID.randomUUID().toString()
        val directory = File(context.cacheDir, "shared-records/$batchId").apply {
            mkdirs()
        }
        val marker = File(directory, ".generating").apply { writeText("active") }
        directory.setLastModified(0)

        val maintenance = CaptureMaintenance(context)
        assertFalse(
            maintenance.cleanupShareBatch(
                batchId,
                maxAgeMs = 0,
                generatingStaleMs = 60_000,
                leaseMaxAgeMs = 86_400_000,
            ),
        )
        assertTrue(directory.exists())

        marker.setLastModified(0)
        assertTrue(
            maintenance.cleanupShareBatch(
                batchId,
                maxAgeMs = 0,
                generatingStaleMs = 0,
                leaseMaxAgeMs = 86_400_000,
            ),
        )
        assertFalse(directory.exists())

        val leasedId = UUID.randomUUID().toString()
        val leasedDirectory = File(
            context.cacheDir,
            "shared-records/$leasedId",
        ).apply { mkdirs() }
        val lease = File(leasedDirectory, ".lease").apply {
            writeText("leased")
            setLastModified(System.currentTimeMillis())
        }
        assertFalse(
            maintenance.cleanupShareBatch(
                leasedId,
                maxAgeMs = 0,
                generatingStaleMs = 0,
                leaseMaxAgeMs = 60_000,
            ),
        )
        lease.setLastModified(0)
        assertTrue(
            maintenance.cleanupShareBatch(
                leasedId,
                maxAgeMs = 0,
                generatingStaleMs = 0,
                leaseMaxAgeMs = 0,
            ),
        )
    }

    @Test
    fun storageSummaryCountsPrivateFiles() {
        val marker = File(root, "counted.bin").apply {
            writeBytes(ByteArray(4096) { 1 })
        }
        assertTrue(marker.exists())
        assertTrue(CaptureMaintenance(context).appStorageBytes() >= marker.length())
    }
}
