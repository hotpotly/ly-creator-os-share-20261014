#!/bin/sh
set -eu
umask 077

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
signing_dir="$root/android/.private-signing"
properties="$signing_dir/private-signing.properties"
keystore="$signing_dir/ly-creator-release.jks"

if [ -f "$properties" ] && [ -f "$keystore" ]; then
  echo "私人签名已经存在：$properties"
  exit 0
fi
if [ -e "$properties" ] || [ -e "$keystore" ]; then
  echo "私人签名文件不完整，请先人工检查：$signing_dir" >&2
  exit 1
fi

mkdir -p "$signing_dir"
chmod 700 "$signing_dir"
password="$(openssl rand -hex 24)"
key_alias="${LY_ANDROID_SIGNING_ALIAS:-creator-os-private}"
key_dname="${LY_ANDROID_SIGNING_DNAME:-CN=Creator OS Private, OU=Personal, O=Creator OS}"
temporary_keystore="$keystore.tmp.$$"
temporary_properties="$properties.tmp.$$"
trap 'rm -f "$temporary_keystore" "$temporary_properties"' EXIT HUP INT TERM
keytool -genkeypair \
  -keystore "$temporary_keystore" \
  -storepass "$password" \
  -keypass "$password" \
  -alias "$key_alias" \
  -keyalg RSA \
  -keysize 3072 \
  -validity 36500 \
  -dname "$key_dname" \
  >/dev/null

cat >"$temporary_properties" <<EOF
storeFile=.private-signing/ly-creator-release.jks
storePassword=$password
keyAlias=$key_alias
keyPassword=$password
EOF
chmod 600 "$temporary_properties" "$temporary_keystore"
mv "$temporary_keystore" "$keystore"
mv "$temporary_properties" "$properties"
trap - EXIT HUP INT TERM
echo "已创建本机私人release签名；密钥和密码已被Git忽略。"
