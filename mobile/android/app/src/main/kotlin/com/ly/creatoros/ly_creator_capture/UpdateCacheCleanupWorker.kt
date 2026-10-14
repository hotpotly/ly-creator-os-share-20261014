package com.ly.creatoros.ly_creator_capture

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class UpdateCacheCleanupWorker(
    context: Context,
    parameters: WorkerParameters,
) : Worker(context, parameters) {
    companion object {
        const val uniqueName = "ly-update-cache-cleanup"
    }

    override fun doWork(): Result = runCatching {
        CaptureMaintenance(applicationContext).cleanupUpdateCache()
        Result.success()
    }.getOrElse {
        Result.retry()
    }
}
