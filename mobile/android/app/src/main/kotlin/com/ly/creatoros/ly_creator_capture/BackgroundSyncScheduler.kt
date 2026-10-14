package com.ly.creatoros.ly_creator_capture

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.NetworkType
import dev.fluttercommunity.workmanager.BackgroundWorker
import java.util.concurrent.TimeUnit

object BackgroundSyncScheduler {
    private const val uniqueName = "ly.creator.capture.immediate-sync-v1"
    private const val dartTask = "ly.creator.capture.immediate-sync-v1"

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequest.Builder(BackgroundWorker::class.java)
            .setInputData(
                Data.Builder()
                    .putString(BackgroundWorker.DART_TASK_KEY, dartTask)
                    .build(),
            )
            .setConstraints(
                Constraints.Builder()
                    .setRequiresStorageNotLow(true)
                    .setRequiresBatteryNotLow(true)
                    .setRequiredNetworkType(NetworkType.UNMETERED)
                    .build(),
            )
            .setInitialDelay(30, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            uniqueName,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
