package com.ly.creatoros.ly_creator_capture

import android.app.Activity
import android.graphics.Color
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.UUID

class ShareReceiverActivity : Activity() {
    private lateinit var message: TextView
    private lateinit var importJobId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        importJobId = savedInstanceState?.getString(ImportService.extraImportJobId)
            ?: UUID.randomUUID().toString()
        intent.putExtra(ImportService.extraImportJobId, importJobId)
        val density = resources.displayMetrics.density
        val dark = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding((28 * density).toInt(), (30 * density).toInt(), (28 * density).toInt(), (30 * density).toInt())
            setBackgroundColor(if (dark) Color.rgb(21, 21, 21) else Color.rgb(250, 248, 243))
        }
        root.addView(ProgressBar(this), LinearLayout.LayoutParams((34 * density).toInt(), (34 * density).toInt()))
        message = TextView(this).apply {
            text = "正在复制到离线队列…"
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(if (dark) Color.rgb(242, 242, 242) else Color.rgb(44, 44, 44))
            setPadding(0, (18 * density).toInt(), 0, 0)
        }
        root.addView(message, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        val sourceApp = referrer?.host
            ?: callingPackage
            ?: intent.getStringExtra(Intent.EXTRA_REFERRER_NAME)
        try {
            // ImportService overwrites every internal extra, so a sharing app
            // cannot choose our idempotency key or a local cleanup path.
            ImportService.enqueue(
                this,
                intent,
                sourceApp,
                importJobId,
            )
            message.text = "正在后台安全保存…"
            Toast.makeText(this, "已开始安全保存，可返回原App", Toast.LENGTH_SHORT).show()
            message.postDelayed({ finish() }, 350)
        } catch (error: Exception) {
            message.text = "无法启动安全导入"
            Toast.makeText(this, error.message ?: "安全导入失败", Toast.LENGTH_LONG).show()
            message.postDelayed({ finish() }, 1400)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(ImportService.extraImportJobId, importJobId)
        super.onSaveInstanceState(outState)
    }
}
