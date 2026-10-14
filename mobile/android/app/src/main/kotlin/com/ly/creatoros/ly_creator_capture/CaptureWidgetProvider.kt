package com.ly.creatoros.ly_creator_capture

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class CaptureWidgetProvider : AppWidgetProvider() {
    companion object {
        private const val preferences = "ly_capture_widget"
        private const val pendingKey = "pending_count"
        private const val recordingKey = "recording"

        fun updateAll(context: Context, pendingCount: Int, recording: Boolean) {
            context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
                .edit()
                .putInt(pendingKey, pendingCount.coerceAtLeast(0))
                .putBoolean(recordingKey, recording)
                .apply()
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, CaptureWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            ids.forEach { manager.updateAppWidget(it, views(context, pendingCount, recording)) }
        }

        fun updateRecording(context: Context, recording: Boolean) {
            val settings = context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
            updateAll(context, settings.getInt(pendingKey, 0), recording)
        }

        fun updatePending(context: Context, pendingCount: Int) {
            val settings = context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
            updateAll(context, pendingCount, settings.getBoolean(recordingKey, false))
        }

        private fun views(
            context: Context,
            pendingCount: Int,
            recording: Boolean,
        ): RemoteViews = RemoteViews(context.packageName, R.layout.capture_widget).apply {
            setTextViewText(
                R.id.widget_status,
                if (recording) "正在录音" else "待同步$pendingCount",
            )
            setTextViewText(R.id.widget_record, if (recording) "保存" else "录音")
            setOnClickPendingIntent(
                R.id.widget_text,
                activityAction(context, MainActivity.actionOpenText, 21),
            )
            setOnClickPendingIntent(
                R.id.widget_record,
                PendingIntent.getBroadcast(
                    context,
                    22,
                    Intent(context, QuickCaptureReceiver::class.java)
                        .setAction(QuickCaptureReceiver.actionToggleRecording),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            setOnClickPendingIntent(
                R.id.widget_camera,
                activityAction(context, MainActivity.actionTakePhoto, 23),
            )
            setOnClickPendingIntent(
                R.id.widget_status,
                activityAction(context, MainActivity.actionSync, 24),
            )
        }

        private fun activityAction(
            context: Context,
            action: String,
            requestCode: Int,
        ): PendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            Intent(context, MainActivity::class.java)
                .setAction(action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val settings = context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
        val pending = settings.getInt(pendingKey, 0)
        val recording = settings.getBoolean(recordingKey, false)
        appWidgetIds.forEach {
            appWidgetManager.updateAppWidget(it, views(context, pending, recording))
        }
    }
}
