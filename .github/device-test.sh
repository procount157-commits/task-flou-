#!/usr/bin/env bash
# Called by the Device test workflow inside the running emulator.
set -x
PKG=com.procount.hayati
mkdir -p out
adb install -r -g android/app/build/outputs/apk/release/app-release.apk
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
# first launch creates the data directory; then the seeded storage replaces whatever it wrote
adb shell monkey -p $PKG 1; sleep 8; adb shell am force-stop $PKG
adb push RKStorage /data/local/tmp/RKStorage
adb shell "run-as $PKG sh -c 'mkdir -p databases && rm -f databases/RKStorage* && cp /data/local/tmp/RKStorage databases/RKStorage'"
adb logcat -c
adb logcat -v time > out/logcat.txt 2>&1 &
adb shell monkey -p $PKG 1; sleep 15
adb exec-out screencap -p > out/00-launch.png
for r in $ROUTES; do
  path=$r; [ "$r" = index ] && path=
  adb shell am start -W -a android.intent.action.VIEW -d "hayati:///$path" $PKG
  sleep 6
  adb exec-out screencap -p > "out/$r.png"
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml | grep -o 'text="[^"]*"' | sed 's/text="//;s/"$//' | grep -v '^$' > "out/$r.txt"
  pid=$(adb shell pidof $PKG); echo "$r pid=$pid" >> out/pids.txt
done
adb shell "run-as $PKG cat databases/RKStorage" > out/RKStorage-after
grep -E 'ReactNativeJS|AndroidRuntime|FATAL|hayati' out/logcat.txt > out/js.txt || true
kill %1 || true
exit 0
