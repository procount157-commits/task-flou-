import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { TaskDetail, TaskRow, useTaskActions } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { useEntity } from '@/lib/db';
import { sortTasks } from '@/lib/logic';
import type { DailyTask, Priority } from '@/lib/types';
import { PomodoroBar, Txt } from '@/ui/kit';

const QUADS: (Priority | undefined)[] = ['high', 'medium', 'low', undefined];

// The four quadrants map onto the four priority levels, as in TickTick's matrix view.
export default function Matrix() {
  const c = useTheme();
  const { t, dir } = useLang();
  const tasks = useEntity('DailyTask').items;
  const { toggle } = useTaskActions();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useCallback((x: DailyTask) => setOpenId(x.id), []);
  const pending = useMemo(() => sortTasks(tasks.filter((x) => !x.parent_id && !x.completed)), [tasks]);
  const colors = [c.danger, c.warn, c.primary, c.muted];
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: dir }}>
      <PomodoroBar />
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', padding: 6 }}>
        {QUADS.map((p, i) => {
          const list = pending.filter((x) => x.priority === p);
          return (
            <View key={i} style={{ width: '50%', height: '50%', padding: 5 }}>
              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, overflow: 'hidden', borderTopWidth: 3, borderTopColor: colors[i] }}>
                <View style={{ padding: 8 }}><Txt v="small" color={colors[i]} style={{ fontWeight: '700' }}>{t.tasks.quad[i]} · {list.length}</Txt></View>
                <ScrollView>{list.map((x) => <TaskRow key={x.id} task={x} subDone={0} subTotal={0} showDate onToggle={toggle} onOpen={open} />)}</ScrollView>
              </View>
            </View>
          );
        })}
      </View>
      <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />
    </View>
  );
}
