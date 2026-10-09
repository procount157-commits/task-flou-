import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { memo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PostponeTo, TaskRow } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import type { DailyTask } from '@/lib/types';
import { Sheet } from '@/ui/kit';
import { DatePickerSheet } from '@/ui/pickers';
import { Text } from '@/ui/text';

const buzz = () => Platform.OS !== 'web' && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

type Props = {
  task: DailyTask; subDone: number; subTotal: number; showDate?: boolean;
  selecting: boolean; selected: boolean;
  onToggle: (t: DailyTask) => void; onOpen: (t: DailyTask) => void;
  onPostpone: (t: DailyTask) => void; onSelect: (t: DailyTask) => void;
};

/** A task row that is swiped right to finish, left to postpone, and long-pressed to start selecting. */
export const SwipeTask = memo(function SwipeTask({ task, subDone, subTotal, showDate, selecting, selected, onToggle, onOpen, onPostpone, onSelect }: Props) {
  const c = useTheme();
  const { t, dir } = useLang();
  const ref = useRef<SwipeableMethods>(null);
  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, color: string, side: 'start' | 'end') => (
    <View style={{ width: 96, backgroundColor: color, alignItems: 'center', justifyContent: 'center', gap: 2, alignSelf: 'stretch', [side === 'start' ? 'paddingStart' : 'paddingEnd']: 8 }}>
      <Ionicons name={icon} size={22} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 11 }}>{label}</Text>
    </View>
  );
  const row = (
    <Pressable onLongPress={() => { buzz(); onSelect(task); }} delayLongPress={350} onPress={selecting ? () => onSelect(task) : undefined} disabled={!selecting && false}>
      <View pointerEvents={selecting ? 'none' : 'auto'} style={{ direction: dir }}>
        <View style={selected ? { backgroundColor: c.soft } : undefined}>
          <TaskRow task={task} subDone={subDone} subTotal={subTotal} showDate={showDate} onToggle={onToggle} onOpen={onOpen} selected={selected} selecting={selecting} />
        </View>
      </View>
    </Pressable>
  );
  return (
    // only a fade on arrival: exit and layout animations inside a virtualised list leave empty gaps on Android
    // the swipeable measures its hidden actions assuming left-to-right; in an RTL parent the right-hand
    // action measured zero wide and a left swipe could never open, so only the row itself is RTL
    <Animated.View entering={FadeIn.duration(180)} style={{ direction: 'ltr' }}>
      {selecting ? row : (
        <ReanimatedSwipeable
          ref={ref}
          friction={1.6}
          leftThreshold={70}
          rightThreshold={70}
          overshootLeft={false}
          overshootRight={false}
          renderLeftActions={() => action('checkmark-circle', t.swipe.done, c.success, 'start')}
          renderRightActions={() => action('time', t.swipe.later, c.warn, 'end')}
          onSwipeableOpen={(dir) => {
            ref.current?.close();
            buzz();
            // RIGHT: the row was dragged to the right, showing the left-hand (done) action
            if (dir === SwipeDirection.RIGHT) onToggle(task);
            else onPostpone(task);
          }}>
          {row}
        </ReanimatedSwipeable>
      )}
    </Animated.View>
  );
});

/** The choices when a task (or several) is pushed later. */
export function PostponeSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (to: PostponeTo) => void }) {
  const c = useTheme();
  const { t, dir } = useLang();
  const [picking, setPicking] = useState(false);
  const opts: { to: PostponeTo; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { to: 'hour', icon: 'hourglass-outline', label: t.swipe.hour },
    { to: 'tonight', icon: 'moon-outline', label: t.swipe.tonight },
    { to: 'tomorrow', icon: 'sunny-outline', label: t.swipe.tomorrow },
    { to: 'dayAfter', icon: 'calendar-outline', label: t.swipe.dayAfter },
    { to: 'nextWeek', icon: 'calendar-number-outline', label: t.swipe.nextWeek },
  ];
  return (
    <>
      <Sheet visible={visible && !picking} onClose={onClose} title={t.swipe.title}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, direction: dir }}>
          {opts.map((o) => (
            <Pressable key={o.label} onPress={() => { onPick(o.to); onClose(); }} accessibilityRole="button"
              style={{ width: '30%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: c.soft }}>
              <Ionicons name={o.icon} size={24} color={c.primary} />
              <Text style={{ color: c.text, fontSize: 13 }}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button"
            style={{ width: '30%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: c.soft }}>
            <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={c.primary} />
            <Text style={{ color: c.text, fontSize: 13 }}>{t.swipe.pick}</Text>
          </Pressable>
        </View>
      </Sheet>
      <DatePickerSheet visible={picking} value={undefined} onChange={(v) => { if (v) onPick({ date: v }); setPicking(false); onClose(); }} onClose={() => setPicking(false)} allowClear={false} />
    </>
  );
}
