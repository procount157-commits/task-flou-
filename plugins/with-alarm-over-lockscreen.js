const { withAndroidManifest } = require('expo/config-plugins');

// Lets the app's window appear over the lock screen and wake the display, so a ringing alarm
// can be answered without unlocking the phone first.
module.exports = function withAlarmOverLockscreen(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = cfg.modResults.manifest.application?.[0]?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (activity) {
      activity.$['android:showWhenLocked'] = 'true';
      activity.$['android:turnScreenOn'] = 'true';
    }
    return cfg;
  });
};
