import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useProfile } from '@/ctx/Auth';
import { useLang } from '@/ctx/Lang';
import { useKV } from '@/lib/db';
import { CalInfo, listWritableCalendars, syncAllTasks } from '@/lib/devicecal';
import { Btn, Chips, Sheet, Txt, notice } from '@/ui/kit';

/**
 * Asked once, after the first launch: which of the phone's calendars the tasks go to. Google accounts
 * are listed first; choosing one turns on automatic sync and writes the upcoming tasks straight away.
 */
export function CalendarSetup() {
  const { t } = useLang();
  const { needsIntention } = useProfile();
  const [done, setDone] = useKV<boolean>('gcal:setup', false);
  const [, setAuto] = useKV<boolean>('gcal:auto', true);
  const [calId, setCalId] = useKV<string>('gcal:id', '');
  const [cals, setCals] = useState<CalInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  // a few seconds after launch, so it never competes with the app opening
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 4000);
    return () => clearTimeout(id);
  }, []);
  if (Platform.OS === 'web' || done || needsIntention || !ready) return null;

  const load = async () => {
    const all = await listWritableCalendars().catch(() => []);
    setCals(all);
    if (all.length && !all.some((c) => c.id === calId)) await setCalId(all[0].id);
  };
  const finish = async () => {
    setBusy(true);
    await setAuto(true);
    const r = await syncAllTasks();
    setBusy(false);
    await setDone(true);
    const where = r.calendar ? `${r.calendar.title}${r.calendar.account && r.calendar.account !== r.calendar.title ? ` · ${r.calendar.account}` : ''}` : '';
    if (!r.error) notice(t.cal.synced.replace('{n}', String(r.written)).replace('{cal}', where));
  };

  return (
    <Sheet visible onClose={() => setDone(true)} title={`📅 ${t.calSetup.title}`}
      footer={cals?.length ? <Btn title={`✓ ${t.calSetup.connect}`} loading={busy} onPress={finish} /> : <Btn title={t.calSetup.start} onPress={load} />}>
      <Txt>{t.calSetup.body}</Txt>
      {cals && !cals.length ? <Txt v="small">{t.cal.none}</Txt> : null}
      {cals?.length ? (
        <>
          <Txt v="muted">{t.cal.choose}</Txt>
          <Chips options={cals.map((x) => ({ value: x.id, label: `${x.title}${x.account && x.account !== x.title ? ` · ${x.account}` : ''}` }))} value={calId} onChange={setCalId} />
        </>
      ) : null}
      <Btn kind="ghost" title={t.calSetup.later} onPress={() => setDone(true)} />
    </Sheet>
  );
}
