package com.ly.creatoros.ly_creator_capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WidgetStatusReceiver : BroadcastReceiver() {
    companion object {
        const val actionUpdatePending = "ly.creator.capture.UPDATE_WIDGET_PENDING"
        const val pendingCountKey = "pendingCount"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != actionUpdatePending) return
        CaptureWidgetProvider.updatePending(
            context,
            intent.getIntExtra(pendingCountKey, 0),
        )
    }
}
