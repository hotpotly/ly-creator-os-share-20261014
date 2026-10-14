package com.ly.creatoros.ly_creator_capture

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

class ShareCacheCleanupWorker(
    context: Context,
    parameters: WorkerParameters,
) : Worker(context, parameters) {
    companion object {
        private const val batchIdKey = "batchId"

        fun uniqueName(batchId: String): String = "share-cache-cleanup-$batchId"

        fun request(
            batchId: String,
            initialDelay: Long,
            delayUnit: TimeUnit,
        ): OneTimeWorkRequest = OneTimeWorkRequestBuilder<ShareCacheCleanupWorker>()
            .setInputData(workDataOf(batchIdKey to batchId))
            .setInitialDelay(initialDelay, delayUnit)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.MINUTES)
            .build()
    }

    override fun doWork(): Result = runCatching {
        val batchId = inputData.getString(batchIdKey) ?: return Result.failure()
        val cleaned = CaptureMaintenance(applicationContext).cleanupShareBatch(
            batchId = batchId,
            maxAgeMs = 10 * 60 * 1000L,
            generatingStaleMs = 10 * 60 * 1000L,
            leaseMaxAgeMs = 24 * 60 * 60 * 1000L,
        )
        if (cleaned) Result.success() else Result.retry()
    }.getOrElse {
        Result.retry()
    }
}
