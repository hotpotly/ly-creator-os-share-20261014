package com.ly.creatoros.secure_attachment_storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.BufferedInputStream
import java.io.InputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.min

class EncryptedAttachmentStore(private val context: Context) {
    companion object {
        private const val alias = "ly_creator_attachment_key_v1"
        private const val magic = "LYENC001"
        private const val headerBytes = 8 + 8 + 4
        private const val ivBytes = 12
        private const val tagBytes = 16
        const val clearChunkBytes = 256 * 1024
        private val lock = Any()
    }

    data class EncryptedFile(val file: File, val clearSize: Long)
    data class StreamEncryptedFile(
        val file: File,
        val clearSize: Long,
        val sha256: String,
    )

    fun encrypt(
        source: File,
        attachmentId: String,
        deleteSource: Boolean = true,
    ): EncryptedFile = synchronized(lock) {
        if (!source.exists() || source.length() <= 0L) {
            throw IllegalArgumentException("附件原件不存在或为空")
        }
        val clearSize = source.length()
        // The original display name lives only inside the encrypted record.
        // Directory entries use a stable opaque attachment id.
        val destination = File(source.parentFile, "$attachmentId.lyenc")
        val temporary = File(source.parentFile, ".${destination.name}.partial")
        temporary.delete()
        val key = keyForWrite()
        try {
            BufferedInputStream(source.inputStream(), 1024 * 1024).use { input ->
                FileOutputStream(temporary).use { stream ->
                    DataOutputStream(stream).use { output ->
                        output.write(magic.toByteArray(StandardCharsets.US_ASCII))
                        output.writeLong(clearSize)
                        output.writeInt(clearChunkBytes)
                        val buffer = ByteArray(clearChunkBytes)
                        var chunkIndex = 0
                        while (true) {
                            var used = 0
                            while (used < buffer.size) {
                                val count = input.read(buffer, used, buffer.size - used)
                                if (count < 0) break
                                if (count > 0) used += count
                            }
                            if (used <= 0) break
                            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                            cipher.init(Cipher.ENCRYPT_MODE, key)
                            if (cipher.iv.size != ivBytes) {
                                throw IllegalStateException("附件加密随机数长度无效")
                            }
                            cipher.updateAAD(aad(attachmentId, chunkIndex))
                            val encrypted = cipher.doFinal(buffer, 0, used)
                            output.write(cipher.iv)
                            output.writeInt(encrypted.size)
                            output.write(encrypted)
                            chunkIndex += 1
                        }
                        output.flush()
                        stream.fd.sync()
                    }
                }
            }
            Files.move(
                temporary.toPath(),
                destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            if (deleteSource) {
                try {
                    Files.delete(source.toPath())
                } catch (error: Exception) {
                    destination.delete()
                    throw IllegalStateException("附件明文副本清理失败", error)
                }
            }
            destination.setReadable(false, false)
            destination.setReadable(true, true)
            destination.setWritable(false, false)
            destination.setWritable(true, true)
            EncryptedFile(destination, clearSize)
        } finally {
            temporary.delete()
        }
    }

    /**
     * Copies a provider stream straight into the Keystore-backed container.
     * The clear size is patched into the temporary header only after EOF, so
     * providers do not need to expose a trustworthy length up front.
     */
    fun encryptStream(
        source: InputStream,
        directory: File,
        attachmentId: String,
        onProgress: ((Long) -> Unit)? = null,
    ): StreamEncryptedFile = synchronized(lock) {
        directory.mkdirs()
        val destination = File(directory, "$attachmentId.lyenc")
        val temporary = File(directory, ".${destination.name}.partial")
        temporary.delete()
        val key = keyForWrite()
        val digest = MessageDigest.getInstance("SHA-256")
        var clearSize = 0L
        try {
            BufferedInputStream(source, 1024 * 1024).use { input ->
                FileOutputStream(temporary).use { stream ->
                    DataOutputStream(stream).use { output ->
                        output.write(magic.toByteArray(StandardCharsets.US_ASCII))
                        output.writeLong(0L)
                        output.writeInt(clearChunkBytes)
                        val buffer = ByteArray(clearChunkBytes)
                        var chunkIndex = 0
                        while (true) {
                            var used = 0
                            while (used < buffer.size) {
                                val count = input.read(buffer, used, buffer.size - used)
                                if (count < 0) break
                                if (count > 0) used += count
                            }
                            if (used <= 0) break
                            digest.update(buffer, 0, used)
                            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                            cipher.init(Cipher.ENCRYPT_MODE, key)
                            if (cipher.iv.size != ivBytes) {
                                throw IllegalStateException("附件加密随机数长度无效")
                            }
                            cipher.updateAAD(aad(attachmentId, chunkIndex))
                            val encrypted = cipher.doFinal(buffer, 0, used)
                            output.write(cipher.iv)
                            output.writeInt(encrypted.size)
                            output.write(encrypted)
                            clearSize += used
                            onProgress?.invoke(clearSize)
                            chunkIndex += 1
                        }
                        output.flush()
                        stream.fd.sync()
                    }
                }
            }
            if (clearSize <= 0L) throw IllegalArgumentException("不支持空文件")
            RandomAccessFile(temporary, "rw").use { header ->
                header.seek(magic.length.toLong())
                header.writeLong(clearSize)
                header.fd.sync()
            }
            Files.move(
                temporary.toPath(),
                destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            destination.setReadable(false, false)
            destination.setReadable(true, true)
            destination.setWritable(false, false)
            destination.setWritable(true, true)
            StreamEncryptedFile(
                destination,
                clearSize,
                digest.digest().joinToString("") { "%02x".format(it) },
            )
        } finally {
            temporary.delete()
        }
    }

    fun clearSize(file: File): Long = RandomAccessFile(file, "r").use { input ->
        verifyHeader(input).first
    }

    fun readChunk(file: File, attachmentId: String, chunkIndex: Int): ByteArray =
        synchronized(lock) {
            if (chunkIndex < 0) throw IllegalArgumentException("附件分块序号无效")
            val key = keyForRead()
            RandomAccessFile(file, "r").use { input ->
                val (clearSize, chunkSize) = verifyHeader(input)
                val chunkCount = ((clearSize + chunkSize - 1) / chunkSize).toInt()
                if (chunkIndex >= chunkCount) throw IllegalArgumentException("附件分块序号越界")
                val recordBytes = ivBytes + 4L + chunkSize + tagBytes
                input.seek(headerBytes.toLong() + chunkIndex.toLong() * recordBytes)
                val iv = ByteArray(ivBytes)
                input.readFully(iv)
                val encryptedSize = input.readInt()
                val expectedClearSize = min(
                    chunkSize.toLong(),
                    clearSize - chunkIndex.toLong() * chunkSize,
                ).toInt()
                if (encryptedSize != expectedClearSize + tagBytes) {
                    throw IllegalStateException("附件加密分块长度无效")
                }
                val encrypted = ByteArray(encryptedSize)
                input.readFully(encrypted)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                cipher.updateAAD(aad(attachmentId, chunkIndex))
                val clear = cipher.doFinal(encrypted)
                if (clear.size != expectedClearSize) {
                    throw IllegalStateException("附件加密分块校验失败")
                }
                clear
            }
        }

    fun decryptToFile(
        file: File,
        attachmentId: String,
        destination: File,
    ): File = synchronized(lock) {
        val size = clearSize(file)
        val count = ((size + clearChunkBytes - 1) / clearChunkBytes).toInt()
        destination.parentFile?.mkdirs()
        try {
            FileOutputStream(destination).use { output ->
                for (index in 0 until count) {
                    output.write(readChunk(file, attachmentId, index))
                }
                output.fd.sync()
            }
            destination
        } catch (error: Exception) {
            destination.delete()
            throw error
        }
    }

    private fun verifyHeader(input: RandomAccessFile): Pair<Long, Int> {
        val storedMagic = ByteArray(8)
        input.readFully(storedMagic)
        if (storedMagic.toString(StandardCharsets.US_ASCII) != magic) {
            throw IllegalStateException("附件加密格式无效")
        }
        val clearSize = input.readLong()
        val chunkSize = input.readInt()
        if (clearSize <= 0L || chunkSize != clearChunkBytes) {
            throw IllegalStateException("附件加密头无效")
        }
        return clearSize to chunkSize
    }

    private fun aad(attachmentId: String, chunkIndex: Int): ByteArray =
        "ly-private-attachment-v1\n$attachmentId\n$chunkIndex"
            .toByteArray(StandardCharsets.UTF_8)

    private fun keyForWrite(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun keyForRead(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return store.getKey(alias, null) as? SecretKey
            ?: throw IllegalStateException("附件安全密钥不可用，原件仍保留但无法读取")
    }
}
