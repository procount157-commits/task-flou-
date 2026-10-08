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
adb shell "run-as $PKG ls -la databases" > out/seed.txt 2>&1
adb shell "run-as $PKG cat databases/RKStorage" > out/RKStorage-seeded
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

# Taps the first element whose text or description contains $1 (the centre of its bounds).
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml > /tmp/ui.xml
  xy=$(python3 - "$1" <<'PY'
import re, sys, html
want = sys.argv[1]
for m in re.finditer(r'<node [^>]*>', open('/tmp/ui.xml', encoding='utf-8').read()):
    n = m.group(0)
    t = html.unescape(re.search(r' text="([^"]*)"', n).group(1) + ' ' + re.search(r'content-desc="([^"]*)"', n).group(1))
    if want in t:
        a, b, c, d = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        print((a + c) // 2, (b + d) // 2); break
PY
)
  echo "tap '$1' -> $xy" >> out/steps.txt
  [ -n "$xy" ] && adb shell input tap $xy
  sleep 2
}
shot() { sleep ${2:-3}; adb exec-out screencap -p > "out/step-$1.png"; adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml | grep -o 'text="[^"]*"' | sed 's/text="//;s/"$//' | grep -v '^$' > "out/step-$1.txt"; }
go() { adb shell am start -W -a android.intent.action.VIEW -d "hayati:///$1" $PKG >/dev/null; sleep 5; }

# voice: record a few seconds in brainstorm, stop, and keep whatever the app says
adb shell pm grant $PKG android.permission.RECORD_AUDIO || true
go brainstorm; shot voice-0 1
tap 'تسجيل صوتي'; shot voice-recording 4
tap 'إيقاف'; shot voice-after 3; shot voice-after-10 10
adb shell "run-as $PKG ls -la files cache 2>&1" > out/recordings.txt
adb shell "run-as $PKG sh -c 'find . -name \"*.m4a\" -exec ls -la {} \\;'" >> out/recordings.txt 2>&1
# a real Arabic clip shipped with the app, through the same transcription path
adb shell input keyevent KEYCODE_BACK; sleep 1
go check
for k in 1 2 3 4 5; do adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml | grep -q 'تحويل الصوت' && break; adb shell input swipe 500 1500 500 500 300; sleep 1; done
tap 'تحويل الصوت'; shot stt-test 12
adb shell "run-as $PKG cat databases/RKStorage" > out/RKStorage-after
grep -E 'ReactNativeJS|AndroidRuntime|FATAL|hayati' out/logcat.txt > out/js.txt || true
kill %1 || true
exit 0
