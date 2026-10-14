package com.ly.creatoros.ly_creator_capture

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Xml
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Locale
import org.xmlpull.v1.XmlPullParser

/**
 * Removes location and device identity without transcoding user media.
 * Documents and unknown formats are intentionally left byte-for-byte unchanged.
 */
object MediaPrivacySanitizer {
    private const val maximumSampleBytes = 128 * 1024 * 1024
    data class Result(
        val mimeType: String,
        val preferredExtension: String?,
        val captureTimeMillis: Long? = null,
    )

    private val privateExifTags = arrayOf(
        ExifInterface.TAG_GPS_LATITUDE,
        ExifInterface.TAG_GPS_LATITUDE_REF,
        ExifInterface.TAG_GPS_LONGITUDE,
        ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE,
        ExifInterface.TAG_GPS_ALTITUDE_REF,
        ExifInterface.TAG_GPS_TIMESTAMP,
        ExifInterface.TAG_GPS_DATESTAMP,
        ExifInterface.TAG_GPS_PROCESSING_METHOD,
        ExifInterface.TAG_GPS_AREA_INFORMATION,
        ExifInterface.TAG_GPS_SATELLITES,
        ExifInterface.TAG_GPS_STATUS,
        ExifInterface.TAG_GPS_MEASURE_MODE,
        ExifInterface.TAG_GPS_DOP,
        ExifInterface.TAG_GPS_SPEED_REF,
        ExifInterface.TAG_GPS_SPEED,
        ExifInterface.TAG_GPS_TRACK_REF,
        ExifInterface.TAG_GPS_TRACK,
        ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
        ExifInterface.TAG_GPS_IMG_DIRECTION,
        ExifInterface.TAG_GPS_MAP_DATUM,
        ExifInterface.TAG_GPS_DEST_LATITUDE_REF,
        ExifInterface.TAG_GPS_DEST_LATITUDE,
        ExifInterface.TAG_GPS_DEST_LONGITUDE_REF,
        ExifInterface.TAG_GPS_DEST_LONGITUDE,
        ExifInterface.TAG_GPS_DEST_BEARING_REF,
        ExifInterface.TAG_GPS_DEST_BEARING,
        ExifInterface.TAG_GPS_DEST_DISTANCE_REF,
        ExifInterface.TAG_GPS_DEST_DISTANCE,
        ExifInterface.TAG_GPS_DIFFERENTIAL,
        ExifInterface.TAG_GPS_H_POSITIONING_ERROR,
        ExifInterface.TAG_MAKE,
        ExifInterface.TAG_MODEL,
        ExifInterface.TAG_SOFTWARE,
        ExifInterface.TAG_MAKER_NOTE,
        ExifInterface.TAG_IMAGE_UNIQUE_ID,
        "HostComputer",
        ExifInterface.TAG_BODY_SERIAL_NUMBER,
        ExifInterface.TAG_CAMERA_OWNER_NAME,
        ExifInterface.TAG_LENS_MAKE,
        ExifInterface.TAG_LENS_MODEL,
        ExifInterface.TAG_LENS_SERIAL_NUMBER,
        ExifInterface.TAG_XMP,
    )

    fun sanitize(file: File, mimeType: String): Result {
        val modifiedAt = file.lastModified()
        val result = when {
            mimeType.startsWith("image/") -> {
                val capturedAt = when {
                    ExifInterface.isSupportedMimeType(mimeType) ->
                        sanitizeImage(file)
                    mimeType == "image/gif" -> {
                        sanitizeGif(file)
                        null
                    }
                    mimeType == "image/svg+xml" -> {
                        sanitizeSvg(file)
                        null
                    }
                    else -> null
                }
                Result(mimeType, null, capturedAt)
            }
            mimeType.startsWith("video/") -> sanitizeVideo(file)
            else -> Result(mimeType, null)
        }
        if (modifiedAt > 0L) file.setLastModified(modifiedAt)
        return result
    }

    fun previewBytes(file: File, mimeType: String): ByteArray? {
        val decoded: Bitmap? = if (mimeType.startsWith("video/")) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(file.absolutePath)
                retriever.getFrameAtTime(
                    -1,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                )
            } finally {
                retriever.release()
            }
        } else if (mimeType.startsWith("image/")) {
            val bounds = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            var sample = 1
            while (
                bounds.outWidth / sample > 960 ||
                bounds.outHeight / sample > 960
            ) {
                sample *= 2
            }
            val raw = BitmapFactory.decodeFile(
                file.absolutePath,
                BitmapFactory.Options().apply { inSampleSize = sample },
            )
            raw?.let {
                applyImageOrientation(file, mimeType, it)
            }
        } else {
            null
        }
        val bitmap: Bitmap = decoded ?: return null
        return try {
            val scale = minOf(
                1.0,
                480.0 / maxOf(bitmap.width, bitmap.height).coerceAtLeast(1),
            )
            val preview = if (scale < 1.0) {
                Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * scale).toInt().coerceAtLeast(1),
                    (bitmap.height * scale).toInt().coerceAtLeast(1),
                    true,
                )
            } else {
                bitmap
            }
            try {
                ByteArrayOutputStream().use { output ->
                    preview.compress(Bitmap.CompressFormat.JPEG, 82, output)
                    output.toByteArray()
                }
            } finally {
                if (preview !== bitmap) preview.recycle()
            }
        } finally {
            bitmap.recycle()
        }
    }

    private fun sanitizeImage(file: File): Long? {
        val exif = ExifInterface(file)
        val capturedAt = exif.dateTimeOriginal?.takeIf { it > 0L }
        privateExifTags.forEach { exif.setAttribute(it, null) }
        exif.saveAttributes()
        return capturedAt
    }

    private fun applyImageOrientation(
        file: File,
        mimeType: String,
        bitmap: Bitmap,
    ): Bitmap {
        if (!ExifInterface.isSupportedMimeType(mimeType)) return bitmap
        val orientation = runCatching {
            ExifInterface(file).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL ->
                matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 ->
                matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL ->
                matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 ->
                matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 ->
                matrix.setRotate(-90f)
            else -> return bitmap
        }
        val transformed = Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true,
        )
        if (transformed !== bitmap) bitmap.recycle()
        return transformed
    }

    private fun sanitizeGif(file: File) {
        val temporary = File(file.parentFile, ".${file.name}.privacy")
        temporary.delete()
        DataInputStream(BufferedInputStream(file.inputStream())).use { input ->
            DataOutputStream(
                BufferedOutputStream(temporary.outputStream()),
            ).use { output ->
                val header = ByteArray(13)
                input.readFully(header)
                val signature = String(
                    header,
                    0,
                    6,
                    Charsets.US_ASCII,
                )
                if (signature != "GIF87a" && signature != "GIF89a") {
                    throw IllegalArgumentException("GIF格式无效")
                }
                output.write(header)
                if (header[10].toInt() and 0x80 != 0) {
                    val size = 3 * (1 shl ((header[10].toInt() and 0x07) + 1))
                    copyExactly(input, output, size)
                }
                while (true) {
                    when (val marker = input.readUnsignedByte()) {
                        0x3b -> {
                            output.writeByte(marker)
                            break
                        }
                        0x2c -> {
                            output.writeByte(marker)
                            val descriptor = ByteArray(9)
                            input.readFully(descriptor)
                            output.write(descriptor)
                            if (descriptor[8].toInt() and 0x80 != 0) {
                                val size = 3 * (
                                    1 shl (
                                        (descriptor[8].toInt() and 0x07) + 1
                                        )
                                    )
                                copyExactly(input, output, size)
                            }
                            output.writeByte(input.readUnsignedByte())
                            copyGifSubBlocks(input, output, keep = true)
                        }
                        0x21 -> {
                            val label = input.readUnsignedByte()
                            when (label) {
                                0xfe -> copyGifSubBlocks(
                                    input,
                                    output,
                                    keep = false,
                                )
                                0xff -> {
                                    val blockSize = input.readUnsignedByte()
                                    val application = ByteArray(blockSize)
                                    input.readFully(application)
                                    val privateMetadata = String(
                                        application,
                                        Charsets.ISO_8859_1,
                                    ).contains("XMP", ignoreCase = true)
                                    if (!privateMetadata) {
                                        output.writeByte(marker)
                                        output.writeByte(label)
                                        output.writeByte(blockSize)
                                        output.write(application)
                                    }
                                    copyGifSubBlocks(
                                        input,
                                        output,
                                        keep = !privateMetadata,
                                    )
                                }
                                else -> {
                                    output.writeByte(marker)
                                    output.writeByte(label)
                                    copyGifSubBlocks(
                                        input,
                                        output,
                                        keep = true,
                                    )
                                }
                            }
                        }
                        else -> throw IllegalArgumentException("GIF数据块无效")
                    }
                }
                output.flush()
            }
        }
        Files.move(
            temporary.toPath(),
            file.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    }

    private fun copyGifSubBlocks(
        input: DataInputStream,
        output: DataOutputStream,
        keep: Boolean,
    ) {
        while (true) {
            val size = input.readUnsignedByte()
            if (keep) output.writeByte(size)
            if (size == 0) return
            val bytes = ByteArray(size)
            input.readFully(bytes)
            if (keep) output.write(bytes)
        }
    }

    private fun copyExactly(
        input: DataInputStream,
        output: DataOutputStream,
        size: Int,
    ) {
        val bytes = ByteArray(size)
        input.readFully(bytes)
        output.write(bytes)
    }

    private fun sanitizeSvg(file: File) {
        val temporary = File(file.parentFile, ".${file.name}.privacy")
        temporary.delete()
        val privateNames = Regex(
            """gps|location|latitude|longitude|serial|device|camera|make|model|software|creator|author""",
            RegexOption.IGNORE_CASE,
        )
        var sawSvgRoot = false
        var skippedMetadataDepth = 0
        BufferedInputStream(file.inputStream()).use { input ->
            BufferedOutputStream(temporary.outputStream()).use { output ->
                val parser = Xml.newPullParser().apply {
                    setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
                    setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false)
                    setInput(input, "UTF-8")
                }
                val serializer = Xml.newSerializer().apply {
                    setOutput(output, "UTF-8")
                }
                var event = parser.eventType
                while (event != XmlPullParser.END_DOCUMENT) {
                    if (
                        event == XmlPullParser.DOCDECL ||
                        event == XmlPullParser.ENTITY_REF
                    ) {
                        throw IllegalArgumentException(
                            "SVG包含不安全的文档声明或实体",
                        )
                    }
                    if (skippedMetadataDepth > 0) {
                        if (event == XmlPullParser.START_TAG) {
                            skippedMetadataDepth += 1
                        } else if (event == XmlPullParser.END_TAG) {
                            skippedMetadataDepth -= 1
                        }
                        event = parser.nextToken()
                        continue
                    }
                    when (event) {
                        XmlPullParser.START_DOCUMENT ->
                            serializer.startDocument("UTF-8", true)
                        XmlPullParser.START_TAG -> {
                            val localName = parser.name.lowercase(Locale.ROOT)
                            if (localName == "metadata") {
                                skippedMetadataDepth = 1
                            } else {
                                if (!sawSvgRoot) {
                                    if (localName != "svg") {
                                        throw IllegalArgumentException(
                                            "文件不是有效SVG",
                                        )
                                    }
                                    sawSvgRoot = true
                                }
                                val depth = parser.depth
                                val previousNamespaceCount = if (depth > 1) {
                                    parser.getNamespaceCount(depth - 1)
                                } else {
                                    0
                                }
                                val namespaceCount =
                                    parser.getNamespaceCount(depth)
                                for (
                                    index in previousNamespaceCount until
                                        namespaceCount
                                ) {
                                    serializer.setPrefix(
                                        parser.getNamespacePrefix(index) ?: "",
                                        parser.getNamespaceUri(index) ?: "",
                                    )
                                }
                                serializer.startTag(
                                    parser.namespace,
                                    parser.name,
                                )
                                for (index in 0 until parser.attributeCount) {
                                    val attributeName =
                                        parser.getAttributeName(index)
                                    if (
                                        privateNames.containsMatchIn(
                                            attributeName,
                                        )
                                    ) {
                                        continue
                                    }
                                    serializer.attribute(
                                        parser.getAttributeNamespace(index),
                                        attributeName,
                                        parser.getAttributeValue(index),
                                    )
                                }
                            }
                        }
                        XmlPullParser.END_TAG ->
                            serializer.endTag(parser.namespace, parser.name)
                        XmlPullParser.TEXT ->
                            serializer.text(parser.text)
                        XmlPullParser.CDSECT ->
                            serializer.cdsect(parser.text)
                        XmlPullParser.IGNORABLE_WHITESPACE ->
                            serializer.ignorableWhitespace(parser.text)
                        // Comments and processing instructions are privacy
                        // metadata and are intentionally omitted.
                    }
                    event = parser.nextToken()
                }
                if (!sawSvgRoot || skippedMetadataDepth != 0) {
                    throw IllegalArgumentException("SVG结构不完整")
                }
                serializer.endDocument()
                output.flush()
            }
        }
        Files.move(
            temporary.toPath(),
            file.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    }

    private fun sanitizeVideo(file: File): Result {
        val temporary = File(file.parentFile, ".${file.name}.sanitized")
        temporary.delete()
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        var muxerStarted = false
        try {
            extractor.setDataSource(file.absolutePath)
            if (extractor.trackCount <= 0) throw IllegalArgumentException("视频没有可保存的轨道")
            val formats = (0 until extractor.trackCount).map(extractor::getTrackFormat)
            val trackMimes = formats.map {
                it.getString(MediaFormat.KEY_MIME).orEmpty().lowercase()
            }
            val webmMimes = setOf(
                MediaFormat.MIMETYPE_VIDEO_VP8,
                MediaFormat.MIMETYPE_VIDEO_VP9,
                MediaFormat.MIMETYPE_AUDIO_OPUS,
                MediaFormat.MIMETYPE_AUDIO_VORBIS,
            )
            val useWebm = trackMimes.isNotEmpty() &&
                trackMimes.all(webmMimes::contains)
            val outputFormat = if (useWebm) {
                MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
            } else {
                MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
            }
            muxer = MediaMuxer(
                temporary.absolutePath,
                outputFormat,
            )
            val trackMap = IntArray(extractor.trackCount)
            // 4K keyframes can be much larger than one megabyte even when the
            // container omits KEY_MAX_INPUT_SIZE.
            var maxSampleSize = 16 * 1024 * 1024
            for (index in formats.indices) {
                val format = formats[index]
                trackMap[index] = muxer.addTrack(format)
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    val declaredSampleSize = format.getInteger(
                        MediaFormat.KEY_MAX_INPUT_SIZE,
                    )
                    if (declaredSampleSize > maximumSampleBytes) {
                        throw IllegalArgumentException("视频单帧过大，无法安全清理隐私信息")
                    }
                    maxSampleSize = maxOf(maxSampleSize, declaredSampleSize)
                }
            }
            val metadata = MediaMetadataRetriever()
            var captureTimeMillis: Long? = null
            try {
                metadata.setDataSource(file.absolutePath)
                captureTimeMillis = parseMediaDate(
                    metadata.extractMetadata(
                        MediaMetadataRetriever.METADATA_KEY_DATE,
                    ),
                )
                metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                    ?.toIntOrNull()
                    ?.takeIf { it == 90 || it == 180 || it == 270 }
                    ?.let(muxer::setOrientationHint)
            } finally {
                metadata.release()
            }
            muxer.start()
            muxerStarted = true
            var buffer = ByteBuffer.allocateDirect(maxSampleSize)
            val info = MediaCodec.BufferInfo()
            for (trackIndex in 0 until extractor.trackCount) {
                extractor.selectTrack(trackIndex)
                extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
                while (true) {
                    val announcedSize = extractor.sampleSize
                    if (
                        announcedSize > buffer.capacity() &&
                        announcedSize <= maximumSampleBytes
                    ) {
                        buffer = ByteBuffer.allocateDirect(announcedSize.toInt())
                    } else if (announcedSize > maximumSampleBytes) {
                        throw IllegalArgumentException("视频单帧过大，无法安全清理隐私信息")
                    }
                    buffer.clear()
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) break
                    if (extractor.sampleTrackIndex != trackIndex) {
                        if (!extractor.advance()) break
                        continue
                    }
                    info.set(
                        0,
                        size,
                        extractor.sampleTime.coerceAtLeast(0L),
                        extractor.sampleFlags,
                    )
                    muxer.writeSampleData(trackMap[trackIndex], buffer, info)
                    if (!extractor.advance()) break
                }
                extractor.unselectTrack(trackIndex)
            }
            muxer.stop()
            muxerStarted = false
            muxer.release()
            muxer = null
            if (!temporary.exists() || temporary.length() <= 0L) {
                throw IllegalStateException("视频隐私信息清理失败")
            }
            // Same-directory atomic replacement guarantees that a failed swap never
            // deletes the only complete original.
            Files.move(
                temporary.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            return if (useWebm) {
                Result("video/webm", "webm", captureTimeMillis)
            } else {
                Result("video/mp4", "mp4", captureTimeMillis)
            }
        } finally {
            extractor.release()
            if (muxer != null) {
                if (muxerStarted) runCatching { muxer.stop() }
                runCatching { muxer.release() }
            }
            temporary.delete()
        }
    }

    private fun parseMediaDate(value: String?): Long? {
        val clean = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val patterns = listOf(
            "yyyyMMdd'T'HHmmss.SSS'Z'",
            "yyyyMMdd'T'HHmmss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
        )
        for (pattern in patterns) {
            val parsed = runCatching {
                java.text.SimpleDateFormat(
                    pattern,
                    java.util.Locale.US,
                ).apply {
                    isLenient = false
                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                }.parse(clean)
            }.getOrNull()
            if (parsed != null) return parsed.time
        }
        return null
    }
}
