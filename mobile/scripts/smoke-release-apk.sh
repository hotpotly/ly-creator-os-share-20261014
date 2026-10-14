#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOBILE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APK_PATH=${1:-"$MOBILE_DIR/build/app/outputs/flutter-apk/app-release.apk"}
ADB=${ADB:-"${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"}
PACKAGE="com.ly.creatoros.ly_creator_capture"
ACTIVITY="$PACKAGE/.MainActivity"

if [ ! -x "$ADB" ]; then
  echo "未找到adb：$ADB" >&2
  exit 1
fi

if [ ! -f "$APK_PATH" ]; then
  echo "未找到release APK：$APK_PATH" >&2
  exit 1
fi

SERIAL=${ANDROID_SERIAL:-$("$ADB" devices | awk '/^emulator-[0-9]+[[:space:]]+device$/{print $1; exit}')}
if [ -z "$SERIAL" ]; then
  echo "没有可用的Android模拟器；请先启动后台模拟器或设置ANDROID_SERIAL。" >&2
  exit 1
fi

"$ADB" -s "$SERIAL" install -r "$APK_PATH" >/dev/null
"$ADB" -s "$SERIAL" logcat -c
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am force-stop "$PACKAGE"
"$ADB" -s "$SERIAL" shell am start -n "$ACTIVITY" >/dev/null

PID=""
HOME_VISIBLE=0
UI_DUMP="/sdcard/ly-creator-release-smoke.xml"
for _ in $(seq 1 30); do
  PID=$("$ADB" -s "$SERIAL" shell pidof "$PACKAGE" | tr -d '\r')
  if [ -n "$PID" ]; then
    "$ADB" -s "$SERIAL" shell uiautomator dump "$UI_DUMP" >/dev/null 2>&1 || true
    if "$ADB" -s "$SERIAL" shell cat "$UI_DUMP" 2>/dev/null |
      grep -Eq "待办|计划与复盘|快速记录|一次完成手机设置|解锁"; then
      HOME_VISIBLE=1
      break
    fi
  fi
  sleep 1
done

if [ -z "$PID" ] || [ "$HOME_VISIBLE" -ne 1 ]; then
  "$ADB" -s "$SERIAL" shell dumpsys activity activities |
    grep -E "startingWindow=|topResumedActivity|mResumedActivity" |
    head -20 >&2 || true
  "$ADB" -s "$SERIAL" logcat -d -v threadtime |
    grep -E "FATAL EXCEPTION|AndroidRuntime|Process: $PACKAGE|flutter|Flutter|DatabaseException" |
    tail -120 >&2 || true
  echo "release APK没有进入可交互界面。" >&2
  exit 1
fi

echo "release APK可交互界面检查通过：$PACKAGE pid=$PID"
