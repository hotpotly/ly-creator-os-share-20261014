package com.ly.creatoros.secure_attachment_storage

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small Keystore-backed envelope for native recovery metadata. */
class SecureValueStore {
    companion object {
        private const val alias = "ly_creator_native_metadata_v1"
        private const val prefix = "enc:v1:"
        private val lock = Any()
    }

    fun encrypt(value: String): String = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        prefix + Base64.encodeToString(
            cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    }

    fun decrypt(value: String): String = synchronized(lock) {
        require(value.startsWith(prefix)) { "安全恢复信息没有加密" }
        val combined = Base64.decode(value.removePrefix(prefix), Base64.NO_WRAP)
        require(combined.size > 28) { "安全恢复信息密文无效" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, combined.copyOfRange(0, 12)),
        )
        cipher.doFinal(combined.copyOfRange(12, combined.size))
            .toString(Charsets.UTF_8)
    }

    private fun key(): SecretKey {
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
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}
