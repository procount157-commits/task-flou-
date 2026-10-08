import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';

import { Progress, Row, Txt } from './kit';
import { useTheme } from '@/ctx/Lang';
import { Text } from '@/ui/text';

export type Point = { label: string; value: number; value2?: number; color?: string };

// Vertical bars; value2, when given, is drawn behind as the "total" each bar is measured against.
export function BarChart({ data, height = 130, max, suffix = '' }: { data: Point[]; height?: number; max?: number; suffix?: string }) {
  const c = useTheme();
  const top = max ?? Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)));
  const dense = data.length > 14;
  return (
    <View style={{ direction: 'ltr' }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: dense ? 1 : 3 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, height, justifyContent: 'flex-end', alignItems: 'center' }}>
            {!dense && d.value > 0 ? <Text style={{ fontSize: 9, color: c.muted }}>{d.value}{suffix}</Text> : null}
            <View style={{ width: '100%', height: `${((d.value2 ?? d.value) / top) * 82}%`, backgroundColor: d.value2 !== undefined ? c.track : 'transparent', borderRadius: 3, justifyContent: 'flex-end' }}>
              <View style={{ width: '100%', height: d.value2 !== undefined ? `${d.value2 ? (d.value / d.value2) * 100 : 0}%` : '100%', backgroundColor: d.color ?? c.primary, borderRadius: 3 }} />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: dense ? 1 : 3, marginTop: 4 }}>
        {data.map((d, i) => (
          <Text key={i} numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: c.muted }}>{dense && i % 5 ? '' : d.label}</Text>
        ))}
      </View>
    </View>
  );
}

export function LineChart({ data, height = 130, max, color }: { data: Point[]; height?: number; max?: number; color?: string }) {
  const c = useTheme();
  const [w, setW] = useState(0);
  const values = data.map((d) => d.value);
  const hi = max ?? Math.max(1, ...values);
  const lo = Math.min(0, ...values);
  const pad = 8;
  const x = (i: number) => pad + (data.length > 1 ? (i / (data.length - 1)) * (w - pad * 2) : (w - pad * 2) / 2);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2);
  const stroke = color ?? c.primary;
  return (
    <View style={{ direction: 'ltr' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {lo < 0 ? <Path d={`M${pad} ${y(0)} H${w - pad}`} stroke={c.border} strokeWidth={1} /> : null}
          <Polyline points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" />
          {data.length <= 16 ? data.map((d, i) => <Circle key={i} cx={x(i)} cy={y(d.value)} r={3} fill={stroke} />) : null}
        </Svg>
      ) : <View style={{ height }} />}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: pad }}>
        {data.map((d, i) => (
          <Text key={i} style={{ fontSize: 9, color: c.muted }}>{data.length > 8 && i % Math.ceil(data.length / 7) ? '' : d.label}</Text>
        ))}
      </View>
    </View>
  );
}

export function PieChart({ data, size = 130, unit = '' }: { data: Point[]; size?: number; unit?: string }) {
  const c = useTheme();
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0);
  const r = size / 2;
  let angle = -Math.PI / 2;
  const arcs = slices.map((d) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    const p = (a: number) => `${r + r * Math.cos(a)} ${r + r * Math.sin(a)}`;
    return { d, path: `M${r} ${r} L${p(a0)} A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(a0 + sweep)} Z` };
  });
  if (!total) return null;
  return (
    <Row gap={14} style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {arcs.length === 1 ? <Circle cx={r} cy={r} r={r} fill={arcs[0].d.color ?? c.primary} /> : arcs.map((a, i) => <Path key={i} d={a.path} fill={a.d.color ?? c.primary} stroke={c.card} strokeWidth={1.5} />)}
      </Svg>
      <View style={{ flex: 1, gap: 4 }}>
        {slices.map((d, i) => (
          <Row key={i} gap={6}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: d.color ?? c.primary }} />
            <Txt v="small" style={{ flex: 1 }} color={c.text}>{d.label}</Txt>
            <Txt v="small">{Math.round(d.value * 100) / 100}{unit} · {Math.round((d.value / total) * 100)}%</Txt>
          </Row>
        ))}
      </View>
    </Row>
  );
}

export function HBars({ data, suffix = '%' }: { data: Point[]; suffix?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ gap: 3 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="muted" style={{ flex: 1 }} numberOfLines={1}>{d.label}</Txt>
            <Txt v="muted">{d.value}{suffix}</Txt>
          </Row>
          <Progress value={d.value} color={d.color} />
        </View>
      ))}
    </View>
  );
}
