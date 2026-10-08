import React, { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { useKV } from '@/lib/db';
import { isLockAdmin, lockAvailable, lockScreenNow, MAX_LOCK_MINUTES, pinApp, removeLockAdmin, requestLockAdmin, startPhoneLock, unpinApp } from '@/lib/phonelock';
import { Btn, Card, Chips, Empty, Row, Screen, Section, Txt, confirm } from '@/ui/kit';

const DURATIONS = ['15', '25', '45', '60', '90', '120', String(MAX_LOCK_MINUTES)];

// Hard lock: the screen is forced off for a chosen time. Soft lock: the app is pinned in front.
export default function Lock() {
  const c = useTheme();
  const { t } = useLang();
  const [minutes, setMinutes] = useKV<string>('lock:minutes', '25');
  const [admin, setAdmin] = useState(false);
  const refresh = useCallback(() => setAdmin(isLockAdmin()), []);

  // the permission is granted on a system screen, so it is re-read whenever the app comes back
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  if (!lockAvailable) return <Screen><Empty icon="🔒" text={t.lock.unavailable} /></Screen>;

  return (
    <Screen>
      <Card style={{ borderColor: admin ? c.success : c.warn }}>
        <Txt v="sub">{admin ? t.lock.granted : `1. ${t.lock.grant}`}</Txt>
        {admin
          ? <Btn small kind="ghost" title={t.lock.remove} onPress={() => { removeLockAdmin(); setTimeout(refresh, 600); }} />
          : <Btn title={t.lock.grant} onPress={() => requestLockAdmin(t.lock.explain)} />}
      </Card>

      <Section title={`🔒 ${t.lock.title}`}>
        <Card>
          <Txt v="muted">{t.lock.duration}</Txt>
          <Chips options={DURATIONS.map((d) => ({ value: d, label: d }))} value={minutes} onChange={setMinutes} />
          <Txt v="small" color={c.danger}>⚠️ {t.lock.warn}</Txt>
          <Btn kind="danger" disabled={!admin} title={`${t.lock.start} — ${minutes} ${t.c.minutes}`} onPress={() => confirm(t.lock.confirm, () => startPhoneLock(Number(minutes)), t.lock.start, t.c.cancel)} />
          <Btn kind="ghost" disabled={!admin} title={t.lock.lockOnce} onPress={lockScreenNow} />
        </Card>
      </Section>

      <Section title={t.lock.soft}>
        <Card>
          <Txt v="small">{t.lock.softNote}</Txt>
          <Row>
            <Btn title={t.lock.pin} onPress={pinApp} style={{ flex: 2 }} />
            <Btn kind="ghost" title={t.lock.unpin} onPress={unpinApp} style={{ flex: 1 }} />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
