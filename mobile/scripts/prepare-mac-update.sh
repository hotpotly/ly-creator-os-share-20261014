#!/bin/sh
set -eu
umask 077

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
project="$(CDPATH= cd -- "$root/.." && pwd)"
apk="$root/build/app/outputs/flutter-apk/app-release.apk"
destination="$project/app/.private-release/android"

[ -f "$apk" ] || {
  echo "未找到release APK，请先运行flutter build apk --release。" >&2
  exit 1
}

version="$(awk '/^version:/{print $2; exit}' "$root/pubspec.yaml")"
version_name="${version%%+*}"
version_code="${version##*+}"
case "$version_code" in
  ''|*[!0-9]*) echo "pubspec版本号无效：$version" >&2; exit 1 ;;
esac

mkdir -p "$destination"
temporary_apk="$destination/.ly-creator-capture.apk.tmp.$$"
temporary_json="$destination/.update.json.tmp.$$"
trap 'rm -f "$temporary_apk" "$temporary_json"' EXIT HUP INT TERM
cp "$apk" "$temporary_apk"
cat >"$temporary_json" <<EOF
{"versionCode":$version_code,"versionName":"$version_name"}
EOF
chmod 600 "$temporary_apk" "$temporary_json"
mv "$temporary_apk" "$destination/ly-creator-capture.apk"
mv "$temporary_json" "$destination/update.json"
trap - EXIT HUP INT TERM
echo "已准备Mac私有更新包：$destination"
