import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import type { Step } from '@/lib/integrations';
import { Txt } from '@/ui/kit';
import { Text, useFontFamily } from '@/ui/text';

const MINS = [5, 10, 15, 25, 30, 45, 60, 90];

type Props = {
  steps: Step[];
  onChange: (s: Step[]) => void;
  onRegenerate?: () => void;
  busy?: boolean;
  error?: string;
};

// The AI's steps, before anything is saved: rename, change minutes, move up/down, delete, add, or ask again.
export function BreakdownEditor({ steps, onChange, onRegenerate, busy, error }: Props) {
  const c = useTheme();
  const { t, dir } = useLang();
  const fontFamily = useFontFamily();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const total = steps.reduce((n, s) => n + (s.minutes ?? 0), 0);
  const set = (i: number, patch: Partial<Step>) => onChange(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const cycleMinutes = (i: number) => {
    const cur = steps[i].minutes ?? 0;
    const nextM = MINS.find((m) => m > cur) ?? MINS[0];
    set(i, { minutes: nextM });
  };
  const icon = (name: keyof typeof Ionicons.glyphMap, press: () => void, label: string, color = c.muted) => (
    <Pressable onPress={press} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={{ padding: 4 }}>
      <Ionicons name={name} size={18} color={color} />
    </Pressable>
  );
  const input = { flex: 1, color: c.text, fontSize: 15, fontFamily, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir, paddingVertical: 4 } as const;

  return (
    <View style={{ gap: 8, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.primary, padding: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt v="muted" style={{ flex: 1 }}>{t.bd.title}</Txt>
        {total ? <Txt v="small">{t.bd.total} {total} {t.bd.min}</Txt> : null}
      </View>
      {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: c.border, paddingBottom: 6 }}>
          <Text style={{ color: c.muted, width: 18 }}>{i + 1}</Text>
          {editing === i ? (
            <TextInput autoFocus value={s.title} onChangeText={(v) => set(i, { title: v })} onBlur={() => setEditing(null)} onSubmitEditing={() => setEditing(null)} style={input} />
          ) : (
            <Pressable style={{ flex: 1 }} onPress={() => setEditing(i)} accessibilityRole="button">
              <Text style={{ color: c.text, fontSize: 15 }}>{s.title}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => cycleMinutes(i)} accessibilityRole="button" style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: c.soft }}>
            <Text style={{ color: c.primary, fontSize: 13 }}>{s.minutes ? `${s.minutes}${t.bd.min}` : '⏱'}</Text>
          </Pressable>
          {icon('chevron-up', () => move(i, -1), '↑')}
          {icon('chevron-down', () => move(i, 1), '↓')}
          {icon('trash-outline', () => onChange(steps.filter((_, k) => k !== i)), t.c.delete, c.danger)}
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput value={draft} onChangeText={setDraft} placeholder={t.bd.ph} placeholderTextColor={c.muted} style={input}
          onSubmitEditing={() => { if (draft.trim()) { onChange([...steps, { title: draft.trim(), minutes: 15 }]); setDraft(''); } }} />
        <Pressable onPress={() => { if (draft.trim()) { onChange([...steps, { title: draft.trim(), minutes: 15 }]); setDraft(''); } }} accessibilityRole="button" style={{ padding: 6 }}>
          <Text style={{ color: c.primary }}>{t.bd.add}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {onRegenerate ? (
          <Pressable onPress={onRegenerate} disabled={busy} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.primary, opacity: busy ? 0.5 : 1 }}>
            <Text style={{ color: c.primary, fontSize: 14 }}>{busy ? t.c.aiWorking : t.bd.remake}</Text>
          </Pressable>
        ) : null}
        {steps.length ? (
          <Pressable onPress={() => onChange([])} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.muted, fontSize: 14 }}>{t.bd.clear}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
