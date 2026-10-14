package com.ly.creatoros.ly_creator_capture

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

class QuickCaptureReceiver : BroadcastReceiver() {
    companion object {
        const val actionToggleRecording = "ly.creator.capture.TOGGLE_RECORDING"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != actionToggleRecording) return
        val recording = RecordingService.snapshot()["state"] in
            setOf("recording", "paused", "finalizing")
        if (recording) {
            context.startService(
                Intent(context, RecordingService::class.java)
                    .setAction(RecordingService.actionStop),
            )
            return
        }
        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .setAction(MainActivity.actionRecord)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, RecordingService::class.java)
                .setAction(RecordingService.actionStart),
        )
    }
}
