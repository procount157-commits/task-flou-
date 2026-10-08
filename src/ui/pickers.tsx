import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Btn, Chips, Row, Sheet, Txt } from './kit';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, isDate, isTime, nowTime, pad, parse, today, ymd } from '@/lib/dates';

type DateProps = { visible: boolean; value?: string; onChange: (v: string | undefined) => void; onClose: () => void; allowClear?: boolean; past?: boolean };

// Calendar sheet: shortcuts on top, a month grid below; one tap picks and closes.
export function DatePickerSheet({ visible, value, onChange, onClose, allowClear = true, past }: DateProps) {
  const c = useTheme();
  const { t, lang } = useLang();
  const [cursor, setCursor] = useState(today().slice(0, 7) + '-01');
  useEffect(() => {
    if (visible) setCursor((isDate(value) ? value! : today()).slice(0, 7) + '-01');
  }, [visible, value]);

  const first = parse(cursor);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => addDays(cursor, i))];
  const shift = (months: number) => setCursor(ymd(new Date(first.getFullYear(), first.getMonth() + months, 1)));
  const choose = (v: string | undefined) => {
    onChange(v);
    onClose();
  };
  const day = today();
  const nav = (label: string, months: number) => (
    <Pressable key={label} onPress={() => shift(months)} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={{ paddingHorizontal: 9, paddingVertical: 6 }}>
      <Text style={{ color: c.primary, fontSize: 17, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const quick = past
    ? []
    : [{ value: day, label: t.c.today }, { value: addDays(day, 1), label: t.c.tomorrow }, { value: addDays(day, 7), label: t.c.nextWeek }];

  return (
    <Sheet visible={visible} onClose={onClose} title={t.c.pickDate}>
      <Chips options={[...quick, ...(allowClear ? [{ value: '', label: t.c.noDate }] : [])]} value={value ?? ''} onChange={(v) => choose(v || undefined)} />
      {/* the grid is laid out left-to-right in both languages so the arrows always match the direction of time */}
      <View style={{ direction: 'ltr', gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }} gap={0}>
          <Row gap={0}>{past ? nav('«', -120) : null}{nav('‹‹', -12)}{nav('‹', -1)}</Row>
          <Txt v="sub">{first.toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' })}</Txt>
          <Row gap={0}>{nav('›', 1)}{nav('››', 12)}{past ? nav('»', 120) : null}</Row>
        </Row>
        <Row gap={0}>{t.daysShort.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: c.muted }}>{d}</Text>)}</Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((d, i) => {
            const on = !!d && d === value;
            return (
              <Pressable key={i} disabled={!d} onPress={() => d && choose(d)} accessibilityRole="button" accessibilityLabel={d ?? ''} style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                {d ? (
                  <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.primary : 'transparent', borderWidth: d === day && !on ? 1.5 : 0, borderColor: c.primary }}>
                    <Text style={{ color: on ? c.onPrimary : c.text, fontSize: 14 }}>{Number(d.slice(8))}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Sheet>
  );
}

type TimeProps = { visible: boolean; value?: string; onChange: (v: string | undefined) => void; onClose: () => void; allowClear?: boolean };
const PRESETS = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

// Time sheet: common times as one-tap chips, plus an hour grid and a minute grid for anything else.
export function TimePickerSheet({ visible, value, onChange, onClose, allowClear = true }: TimeProps) {
  const c = useTheme();
  const { t } = useLang();
  const [h, setH] = useState('08');
  const [m, setM] = useState('00');
  useEffect(() => {
    if (!visible) return;
    const start = isTime(value) ? value! : nowTime();
    setH(start.slice(0, 2));
    setM(pad(Math.floor(Number(start.slice(3)) / 5) * 5));
  }, [visible, value]);
  const choose = (v: string | undefined) => {
    onChange(v);
    onClose();
  };
  const cell = (label: string, on: boolean, press: () => void, width: `${number}%`) => (
    <Pressable key={label} onPress={press} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ width, padding: 3 }}>
      <View style={{ paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: on ? c.primary : c.card, borderWidth: 1, borderColor: on ? c.primary : c.border }}>
        <Text style={{ color: on ? c.onPrimary : c.text, fontSize: 14 }}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={t.c.pickTime} footer={<Btn title={`${t.c.done} — ${h}:${m}`} onPress={() => choose(`${h}:${m}`)} />}>
      <Chips options={[...PRESETS.map((p) => ({ value: p, label: p })), ...(allowClear ? [{ value: '', label: t.c.noTime }] : [])]} value={value ?? ''} onChange={(v) => choose(v || undefined)} />
      <View style={{ direction: 'ltr', gap: 4 }}>
        <Txt v="muted">{t.c.hour}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Array.from({ length: 24 }, (_, i) => pad(i)).map((x) => cell(x, x === h, () => setH(x), '12.5%'))}</View>
        <Txt v="muted">{t.c.minute}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Array.from({ length: 12 }, (_, i) => pad(i * 5)).map((x) => cell(x, x === m, () => setM(x), '16.66%'))}</View>
      </View>
    </Sheet>
  );
}

type FieldProps = { label?: string; value?: string; onChange: (v: string | undefined) => void; error?: string; allowClear?: boolean; past?: boolean };

function FieldShell({ label, text, placeholder, icon, error, onPress }: { label?: string; text: string; placeholder: string; icon: keyof typeof Ionicons.glyphMap; error?: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {label ? <Txt v="muted">{label}</Txt> : null}
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? placeholder}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: error ? c.danger : c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.card }}>
        <Ionicons name={icon} size={18} color={text ? c.primary : c.muted} />
        <Txt style={{ flex: 1 }} color={text ? c.text : c.muted}>{text || placeholder}</Txt>
      </Pressable>
      {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
    </View>
  );
}

export function DateField({ label, value, onChange, error, allowClear, past }: FieldProps) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <>
      <FieldShell label={label} icon="calendar-outline" error={error} placeholder={t.c.pickDate} onPress={() => setOpen(true)}
        text={isDate(value) ? `${fmtDate(value, lang, t.c, true)}${past ? ` · ${value}` : ''}` : ''} />
      <DatePickerSheet visible={open} value={value} onChange={onChange} onClose={() => setOpen(false)} allowClear={allowClear} past={past} />
    </>
  );
}

export function TimeField({ label, value, onChange, error, allowClear }: FieldProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <>
      <FieldShell label={label} icon="time-outline" error={error} placeholder={t.c.pickTime} onPress={() => setOpen(true)} text={isTime(value) ? value! : ''} />
      <TimePickerSheet visible={open} value={value} onChange={onChange} onClose={() => setOpen(false)} allowClear={allowClear} />
    </>
  );
}
