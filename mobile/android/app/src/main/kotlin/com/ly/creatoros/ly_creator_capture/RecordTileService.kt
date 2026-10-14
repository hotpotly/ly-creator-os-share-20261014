package com.ly.creatoros.ly_creator_capture

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class RecordTileService : TileService() {
    companion object {
        fun refresh(context: Context) {
            requestListeningState(
                context,
                ComponentName(context, RecordTileService::class.java),
            )
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        val recording = RecordingService.snapshot()["state"] in
            setOf("recording", "paused", "finalizing")
        qsTile?.apply {
            state = if (recording) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = if (recording) "结束录音" else "灵感录音"
            subtitle = if (recording) "点击保存" else "点击开始"
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        val action = Intent(this, QuickCaptureReceiver::class.java)
            .setAction(QuickCaptureReceiver.actionToggleRecording)
        sendBroadcast(action)
        qsTile?.state = Tile.STATE_UNAVAILABLE
        qsTile?.updateTile()
    }
}
