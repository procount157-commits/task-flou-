import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleProp, Switch, Text, TextInput,
  TextInputProps, TextStyle, View, ViewStyle, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, useTheme } from '@/ctx/Lang';
import { usePomodoro } from '@/ctx/Pomodoro';
import { fmtClock } from '@/lib/dates';

export function notice(msg: string, title = '') {
  if (Platform.OS === 'web') window.alert(title ? `${title}\n${msg}` : msg);
  else Alert.alert(title, msg);
}

export function confirm(msg: string, onYes: () => void, yes = 'OK', no = 'Cancel') {
  if (Platform.OS === 'web') {
    if (window.confirm(msg)) onYes();
  } else Alert.alert('', msg, [{ text: no, style: 'cancel' }, { text: yes, style: 'destructive', onPress: onYes }]);
}

type TxtProps = { v?: 'h' | 'sub' | 'body' | 'muted' | 'small'; color?: string; style?: StyleProp<TextStyle>; children?: React.ReactNode; numberOfLines?: number; center?: boolean };
export function Txt({ v = 'body', color, style, children, numberOfLines, center }: TxtProps) {
  const c = useTheme();
  const { dir } = useLang();
  const base: TextStyle = {
    h: { fontSize: 20, fontWeight: '700' as const },
    sub: { fontSize: 16, fontWeight: '600' as const },
    body: { fontSize: 14 },
    muted: { fontSize: 13, color: c.muted },
    small: { fontSize: 11, color: c.muted },
  }[v];
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: c.text, writingDirection: dir, textAlign: center ? 'center' : dir === 'rtl' ? 'right' : 'left' }, base, color ? { color } : null, style]}>
      {children}
    </Text>
  );
}

export const Row = ({ children, style, gap = 8, wrap }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>
);

export function Card({ children, style, onPress }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useTheme();
  const s: StyleProp<ViewStyle> = [{ backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, gap: 8 }, style];
  return onPress ? <Pressable onPress={onPress} style={s}>{children}</Pressable> : <View style={s}>{children}</View>;
}

type BtnProps = { title: string; onPress?: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> };
export function Btn({ title, onPress, kind = 'primary', small, disabled, loading, style }: BtnProps) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.primary : kind === 'danger' ? c.danger : 'transparent';
  const fg = kind === 'ghost' ? c.primary : kind === 'danger' ? '#fff' : c.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: 10, paddingVertical: small ? 6 : 11, paddingHorizontal: small ? 10 : 16, alignItems: 'center', justifyContent: 'center', borderWidth: kind === 'ghost' ? 1 : 0, borderColor: c.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 12 : 14 }}>{title}</Text>}
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, label, disabled }: { icon: string; onPress?: () => void; label?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityLabel={label ?? icon} accessibilityRole="button" style={{ padding: 6, opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ fontSize: 17 }}>{icon}</Text>
    </Pressable>
  );
}

// Tap-to-fill chips shown under a field, so most fields never need the keyboard.
export function Suggest({ items, onPick }: { items: string[]; onPick: (v: string) => void }) {
  const c = useTheme();
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
      {items.map((it) => (
        <Pressable key={it} onPress={() => onPick(it)} accessibilityRole="button" style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: c.soft }}>
          <Text style={{ color: c.primary, fontSize: 13 }}>{it}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

type InputProps = TextInputProps & { label?: string; error?: string; suggestions?: string[] };
export function Input({ label, error, style, suggestions, ...p }: InputProps) {
  const c = useTheme();
  const { dir } = useLang();
  const value = p.value ?? '';
  // long fields collect several picks; short ones are replaced by the pick
  const pick = (v: string) => p.onChangeText?.(p.multiline && value.trim() && !value.includes(v) ? `${value.trim()}، ${v}` : v);
  return (
    <View style={{ gap: 4 }}>
      {label ? <Txt v="muted">{label}</Txt> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...p}
        style={[
          { borderWidth: 1, borderColor: error ? c.danger : c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, backgroundColor: c.card, fontSize: 14, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir },
          p.multiline ? { minHeight: 84, textAlignVertical: 'top' } : null,
          style,
        ]}
      />
      {suggestions?.length ? <Suggest items={suggestions.filter((x) => x !== value)} onPick={pick} /> : null}
      {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
    </View>
  );
}

export type Opt<V extends string = string> = { value: V; label: string };
export const opts = <V extends string>(o: Record<V, string>) => (Object.keys(o) as V[]).map((value) => ({ value, label: o[value] }));

export function Chips<V extends string>({ options, value, onChange, scroll }: { options: Opt<V>[]; value?: V | null; onChange: (v: V) => void; scroll?: boolean }) {
  const c = useTheme();
  const body = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : c.card }}>
        <Text style={{ color: on ? c.onPrimary : c.text, fontSize: 13 }}>{o.label}</Text>
      </Pressable>
    );
  });
  if (scroll) return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>{body}</ScrollView>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{body}</View>;
}

export function Progress({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const c = useTheme();
  return (
    <View style={{ height, backgroundColor: c.track, borderRadius: height, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(value), min: 0, max: 100 }}>
      <View style={{ height, width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color ?? c.primary, borderRadius: height }} />
    </View>
  );
}

export function Badge({ text, color }: { text: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.soft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: color ? 1 : 0, borderColor: color }}>
      <Text style={{ fontSize: 11, color: color ?? c.text }}>{text}</Text>
    </View>
  );
}

export function Empty({ icon = '📭', text }: { icon?: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 28, gap: 8 }}>
      <Text style={{ fontSize: 38 }}>{icon}</Text>
      <Txt v="muted" center>{text}</Txt>
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

export function Stat({ label, value, icon }: { label: string; value: string | number; icon?: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: '45%', gap: 2 }}>
      <Txt v="small">{icon ? `${icon} ` : ''}{label}</Txt>
      <Txt v="h">{value}</Txt>
    </Card>
  );
}

export function Check({ on, onPress, disabled, round }: { on: boolean; onPress?: () => void; disabled?: boolean; round?: boolean }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }}
      style={{ width: round ? 34 : 24, height: round ? 34 : 24, borderRadius: round ? 17 : 6, borderWidth: 2, borderColor: on ? c.success : c.border, backgroundColor: on ? c.success : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      {on ? <Text style={{ color: '#fff', fontWeight: '700', fontSize: round ? 16 : 13 }}>✓</Text> : null}
    </Pressable>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Txt style={{ flex: 1 }}>{label}</Txt>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.track }} />
    </Row>
  );
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="sub" style={{ flex: 1 }}>{title}</Txt>
        {right}
      </Row>
      {children}
    </View>
  );
}

// A bottom sheet; modals render outside the app root, so the reading direction is set again here.
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children?: React.ReactNode; footer?: React.ReactNode }) {
  const c = useTheme();
  const { dir, t } = useLang();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t.c.close} />
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: height * 0.9, paddingBottom: insets.bottom + 8, direction: dir, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Row style={{ padding: 14, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: c.border }}>
            <Txt v="sub" style={{ flex: 1 }}>{title}</Txt>
            <IconBtn icon="✕" onPress={onClose} label={t.c.close} />
          </Row>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Shown on every screen but the pomodoro one while a session is running.
export function PomodoroBar() {
  const c = useTheme();
  const { t } = useLang();
  const { session, remainingMs } = usePomodoro();
  const path = usePathname();
  const router = useRouter();
  if (!session || path === '/pomodoro') return null;
  return (
    <Pressable onPress={() => router.push('/pomodoro')} accessibilityRole="button" style={{ backgroundColor: session.phase === 'focus' ? c.primary : c.success, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 16 }}>{session.phase === 'focus' ? '🎯' : '⏸'}</Text>
      <Text numberOfLines={1} style={{ color: '#fff', flex: 1, fontWeight: '600' }}>{session.subTasks[session.step] ?? session.taskTitle}</Text>
      <Text style={{ color: '#fff', fontVariant: ['tabular-nums'], fontWeight: '700' }}>{fmtClock(remainingMs)}</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>{session.paused ? t.pomo.paused : session.phase === 'focus' ? t.pomo.focus : t.pomo.break}</Text>
    </Pressable>
  );
}

export function Screen({ children, scroll = true, fab }: { children?: React.ReactNode; scroll?: boolean; fab?: React.ReactNode }) {
  const c = useTheme();
  const { dir } = useLang();
  const { width } = useWindowDimensions();
  // tablets get a centred column instead of edge-to-edge rows
  const inner: ViewStyle = { padding: 14, gap: 14, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: fab ? 96 : 28, paddingHorizontal: width >= 768 ? 24 : 14 };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: dir }}>
      <PomodoroBar />
      {scroll ? <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[inner, { flex: 1 }]}>{children}</View>}
      {fab}
    </View>
  );
}

export function Fab({ icon = '+', onPress, label }: { icon?: string; onPress: () => void; label: string }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ position: 'absolute', bottom: 22, end: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
      <Text style={{ color: c.onPrimary, fontSize: 28, lineHeight: 30 }}>{icon}</Text>
    </Pressable>
  );
}

export function Tabs<V extends string>({ options, value, onChange }: { options: Opt<V>[]; value: V; onChange: (v: V) => void }) {
  return <Chips options={options} value={value} onChange={onChange} scroll />;
}
