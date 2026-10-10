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

# v12: swipe, postpone, day view, goals, review, widget, reminders, floating mic
go ""; shot tasks-0 2
# finger swipes on a row: right finishes, left opens the postpone sheet
row() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > /tmp/ui.xml; python3 - "$1" <<'PY'
import re, sys, html
want = sys.argv[1]
for m in re.finditer(r'<node [^>]*>', open('/tmp/ui.xml', encoding='utf-8').read()):
    n = m.group(0)
    if want in html.unescape(re.search(r' text="([^"]*)"', n).group(1)):
        a, b, c, d = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        print((b + d) // 2); break
PY
}
y=$(row 'مهمة للسحب'); echo "swipe-right y=$y" >> out/steps.txt
W=$(adb shell wm size | grep -o '[0-9]*x' | tail -1 | tr -d x); echo "screen width $W" >> out/steps.txt
[ -n "$y" ] && adb shell input swipe $((W/10)) $y $((W*9/10)) $y 400
shot tasks-swiped-right 3
sleep 4
y=$(row 'مهمة للتأجيل'); echo "swipe-left y=$y" >> out/steps.txt
[ -n "$y" ] && adb shell input swipe $((W*9/10)) $y $((W/10)) $y 400
shot postpone-sheet 2
tap 'بكرة'; shot tasks-postponed 2
# v14: the new add-task screen
go ""; tap 'إضافة مهمة'; shot add-open 3
adb shell input text 'report'; shot add-typed 2
tap 'غداً'; tap '60'; tap 'عالية'; shot add-chips 1
tap 'رتّبها بالذكاء'; shot add-smart 14
tap 'حفظ + أخرى'; shot add-saved 6
adb shell input keyevent 4; sleep 1; adb shell input keyevent 4; sleep 1
go ""; shot tasks-after-add 3

# v14: the hourly question as a card over other apps. It must survive Back and Home and leave only when answered.
# tapw looks in every window, because the card is not the focused one.
tapw() {
  adb shell uiautomator dump --windows /sdcard/uiw.xml >/dev/null 2>&1
  adb shell cat /sdcard/uiw.xml > /tmp/uiw.xml
  xy=$(python3 - "$1" <<'PY'
import re, sys, html
want = sys.argv[1]
for m in re.finditer(r'<node [^>]*>', open('/tmp/uiw.xml', encoding='utf-8', errors='ignore').read()):
    n = m.group(0)
    t = re.search(r' text="([^"]*)"', n)
    if t and want in html.unescape(t.group(1)):
        a, b, c, d = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        print((a + c) // 2, (b + d) // 2); break
PY
)
  echo "tapw '$1' -> $xy" >> out/steps.txt
  [ -n "$xy" ] && adb shell input tap $xy
  sleep 2
}
wshot() { sleep ${2:-3}; adb exec-out screencap -p > "out/step-$1.png"; adb shell uiautomator dump --windows /sdcard/uiw.xml >/dev/null 2>&1 && adb shell cat /sdcard/uiw.xml | grep -o 'text="[^"]*"' | sed 's/text="//;s/"$//' | grep -v '^$' > "out/step-$1.txt"; }
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow
adb shell input keyevent 3; sleep 2
adb shell am broadcast -n $PKG/expo.modules.phonelock.HourlyReceiver
wshot overlay-1 6
adb shell input keyevent 4; adb shell input keyevent 3; wshot overlay-after-back-home 3
tapw 'عمل مركز'; wshot overlay-2 3
tapw 'مركز 🎯'; wshot overlay-3 3
tapw 'قريب 🟢'; wshot overlay-4 3
tapw 'الفشل'; wshot overlay-result 14
wshot overlay-gone 34
adb shell dumpsys window windows 2>/dev/null | grep -c "OverlayService\|type=APPLICATION_OVERLAY" >> out/steps.txt || true
adb shell dumpsys notification --noredact 2>/dev/null | grep -E "hourly-card-2|sound=|notify_chime" | head -20 > out/channels.txt || true

adb shell dumpsys appwidget > out/appwidget.txt 2>&1
grep -c "TasksWidget" out/appwidget.txt >> out/steps.txt || true
adb shell dumpsys alarm > out/alarms.txt 2>&1
echo "nudge alarms: $(grep -c 'NUDGE' out/alarms.txt)" >> out/steps.txt
echo "hourly alarms: $(grep -c 'HourlyReceiver' out/alarms.txt)" >> out/steps.txt
adb shell "run-as $PKG cat databases/RKStorage" > out/RKStorage-after
grep -E 'ReactNativeJS|AndroidRuntime|FATAL|hayati' out/logcat.txt > out/js.txt || true
kill %1 || true
exit 0
