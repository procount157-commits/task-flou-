import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Btn, Chips, IconBtn, Input, Opt, Row, Sheet, Toggle, Txt } from './kit';
import { DateField, TimeField } from './pickers';
import { DaysPicker, RewardPicker, VoiceToText } from './shared';
import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, isTime } from '@/lib/dates';
import { COLOR_CHOICES } from '@/lib/gcal';
import { GenerateImage, pickAttachment, pickImage } from '@/lib/integrations';

export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'multiline' | 'number' | 'date' | 'time' | 'select' | 'bool' | 'days' | 'tags' | 'reward' | 'color' | 'image' | 'files' | 'icon';
  options?: Opt[];
  required?: boolean;
  placeholder?: string;
  // select only: adds a "none" chip that clears the value
  optional?: boolean;
  // multiline only: adds a mic button that appends the transcription
  voice?: boolean;
  icons?: string[];
  // tap-to-fill values offered under a text or number field
  suggestions?: string[];
  // date only: a date in the past (birth date), so year jumps replace the today/tomorrow shortcuts
  past?: boolean;
};

type Values = Record<string, any>;
type Props = {
  visible: boolean; title: string; fields: Field[]; initial?: Values; onSave: (v: Values) => void | Promise<void>; onClose: () => void; children?: React.ReactNode;
  // existing records of the same kind: their values become suggestions for the matching fields
  history?: Values[];
};

// One generic create/edit sheet: every entity screen describes its form as a list of fields.
export function FormModal({ visible, title, fields, initial, onSave, onClose, children, history }: Props) {
  const c = useTheme();
  const { t } = useLang();
  const [v, setV] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const start: Values = { ...initial };
    for (const f of fields) {
      if (f.type === 'number' && start[f.key] != null) start[f.key] = String(start[f.key]);
      if (f.type === 'tags' && Array.isArray(start[f.key])) start[f.key] = start[f.key].join(', ');
    }
    setV(start);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    const out: Values = { ...v };
    for (const f of fields) {
      const raw = v[f.key];
      const blank = raw == null || raw === '' || (Array.isArray(raw) && !raw.length);
      if (f.required && blank) errs[f.key] = t.c.required;
      else if (blank) {
        if (f.type !== 'bool' && f.type !== 'days' && f.type !== 'reward') out[f.key] = f.type === 'tags' || f.type === 'files' ? [] : undefined;
      } else if (f.type === 'date' && !isDate(raw)) errs[f.key] = t.c.invalidDate;
      else if (f.type === 'time' && !isTime(raw)) errs[f.key] = t.c.invalidTime;
      else if (f.type === 'number') {
        const n = Number(String(raw).replace(',', '.'));
        if (isNaN(n)) errs[f.key] = t.c.invalidNumber;
        else out[f.key] = n;
      } else if (f.type === 'tags') out[f.key] = String(raw).split(/[,،]/).map((s) => s.trim()).filter(Boolean);
      else if (typeof raw === 'string') out[f.key] = raw.trim();
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await onSave(out);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const render = (f: Field) => {
    const label = f.label + (f.required ? ' *' : '');
    switch (f.type) {
      case 'select':
        return (
          <View key={f.key} style={{ gap: 4 }}>
            <Txt v="muted">{label}</Txt>
            <Chips options={f.optional ? [{ value: '', label: t.c.none }, ...(f.options ?? [])] : f.options ?? []} value={v[f.key] ?? ''} onChange={(x) => set(f.key, x || undefined)} />
            {errors[f.key] ? <Txt v="small" color={c.danger}>{errors[f.key]}</Txt> : null}
          </View>
        );
      case 'bool':
        return <Toggle key={f.key} label={f.label} value={!!v[f.key]} onChange={(x) => set(f.key, x)} />;
      case 'days':
        return (
          <View key={f.key} style={{ gap: 4 }}>
            <Txt v="muted">{label}</Txt>
            <DaysPicker value={v[f.key] ?? []} onChange={(x) => set(f.key, x)} emptyLabel={f.placeholder} />
          </View>
        );
      case 'reward':
        return <RewardPicker key={f.key} value={v} onChange={(r) => setV((p) => ({ ...p, ...r }))} />;
      case 'color':
        return (
          <View key={f.key} style={{ gap: 4 }}>
            <Txt v="muted">{label}</Txt>
            <Row wrap gap={6}>
              {COLOR_CHOICES.map((col) => (
                <Pressable key={col} onPress={() => set(f.key, col)} accessibilityRole="button" accessibilityLabel={col}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: col, borderWidth: v[f.key] === col ? 3 : 0, borderColor: c.text }} />
              ))}
            </Row>
          </View>
        );
      case 'icon':
        return (
          <View key={f.key} style={{ gap: 4 }}>
            <Txt v="muted">{label}</Txt>
            <Chips options={(f.icons ?? []).map((i) => ({ value: i, label: i }))} value={v[f.key]} onChange={(x) => set(f.key, x)} />
          </View>
        );
      case 'image':
        return (
          <View key={f.key} style={{ gap: 6 }}>
            <Txt v="muted">{label}</Txt>
            {v[f.key] ? <Image source={{ uri: v[f.key] }} style={{ width: '100%', height: 150, borderRadius: 10, backgroundColor: c.track }} contentFit="cover" /> : null}
            <Row wrap>
              <Btn small kind="ghost" title={`🖼 ${t.c.uploadImage}`} onPress={async () => { const u = await pickImage(); if (u) set(f.key, u); }} />
              <Btn small kind="ghost" title={`✨ ${t.c.generateImage}`} disabled={!v.title} onPress={() => set(f.key, GenerateImage(String(v.title)))} />
              {v[f.key] ? <IconBtn icon="✕" label={t.c.delete} onPress={() => set(f.key, undefined)} /> : null}
            </Row>
          </View>
        );
      case 'files':
        return (
          <View key={f.key} style={{ gap: 6 }}>
            <Txt v="muted">{label}</Txt>
            {(v[f.key] ?? []).map((u: string, i: number) => (
              <Row key={u}>
                <Txt v="small" style={{ flex: 1 }} numberOfLines={1}>📎 {u.split('/').pop()}</Txt>
                <IconBtn icon="✕" label={t.c.delete} onPress={() => set(f.key, v[f.key].filter((_: string, k: number) => k !== i))} />
              </Row>
            ))}
            <Btn small kind="ghost" title={`📎 ${t.c.upload}`} onPress={async () => { const u = await pickAttachment(); if (u) set(f.key, [...(v[f.key] ?? []), u]); }} />
          </View>
        );
      case 'date':
        return <DateField key={f.key} label={label} value={v[f.key]} onChange={(x) => set(f.key, x)} error={errors[f.key]} allowClear={!f.required} past={f.past} />;
      case 'time':
        return <TimeField key={f.key} label={label} value={v[f.key]} onChange={(x) => set(f.key, x)} error={errors[f.key]} allowClear={!f.required} />;
      default: {
        // what was entered before comes first, then the ready-made list
        const past = (history ?? []).map((r) => r[f.key]).filter((x) => x != null && x !== '' && !Array.isArray(x)).map(String).reverse();
        const suggestions = f.type === 'tags' ? f.suggestions : [...new Set([...past, ...(f.suggestions ?? [])])].slice(0, 10);
        return (
          <View key={f.key} style={{ gap: 4 }}>
            <Input
              label={label}
              value={v[f.key] == null ? '' : String(v[f.key])}
              onChangeText={(x) => set(f.key, x)}
              error={errors[f.key]}
              multiline={f.type === 'multiline'}
              keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
              placeholder={f.placeholder}
              autoCapitalize="none"
              suggestions={suggestions}
            />
            {f.voice ? <Row><VoiceToText onText={(text) => text && set(f.key, [v[f.key], text].filter(Boolean).join(' '))} /></Row> : null}
          </View>
        );
      }
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} footer={
      <Row>
        <Btn title={t.c.cancel} kind="ghost" onPress={onClose} style={{ flex: 1 }} />
        <Btn title={t.c.save} onPress={submit} loading={saving} style={{ flex: 2 }} />
      </Row>
    }>
      {fields.map(render)}
      {children}
    </Sheet>
  );
}
