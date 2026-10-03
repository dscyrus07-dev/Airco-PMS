import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import type { TaskStatus, TicketStatus } from '@/types/api';
import { PRIORITY_LABELS, TASK_STATUS_LABELS, TICKET_STATUS_LABELS } from '@/utils/format';

interface Tone {
  fg: string;
  bg: string;
}

const TASK_TONES: Record<string, Tone> = {
  pending: { fg: colors.neutralInk, bg: colors.neutralSoft },
  assigned: { fg: colors.infoInk, bg: colors.infoSoft },
  in_progress: { fg: colors.accentInk, bg: colors.accentSoft },
  reopened: { fg: colors.amberInk, bg: colors.amberSoft },
  submitted: { fg: colors.infoInk, bg: colors.infoSoft },
  completed: { fg: colors.accentInk, bg: colors.accentSoft },
  cancelled: { fg: colors.muted, bg: colors.neutralSoft },
  abandoned: { fg: colors.muted, bg: colors.neutralSoft },
  scheduled: { fg: colors.neutralInk, bg: colors.neutralSoft },
  overdue: { fg: colors.dangerInk, bg: colors.dangerSoft },
};

const TICKET_TONES: Record<string, Tone> = {
  open: { fg: colors.infoInk, bg: colors.infoSoft },
  assigned: { fg: colors.infoInk, bg: colors.infoSoft },
  in_progress: { fg: colors.accentInk, bg: colors.accentSoft },
  on_hold: { fg: colors.amberInk, bg: colors.amberSoft },
  resolved: { fg: colors.amberInk, bg: colors.amberSoft },
  closed: { fg: colors.accentInk, bg: colors.accentSoft },
  cancelled: { fg: colors.muted, bg: colors.neutralSoft },
};

const PRIORITY_TONES: Record<string, Tone> = {
  high: { fg: colors.dangerInk, bg: colors.dangerSoft },
  critical: { fg: colors.dangerInk, bg: colors.dangerSoft },
  urgent: { fg: colors.dangerInk, bg: colors.dangerSoft },
  medium: { fg: colors.amberInk, bg: colors.amberSoft },
  low: { fg: colors.neutralInk, bg: colors.neutralSoft },
};

export function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus | string }) {
  return (
    <Pill
      label={TASK_STATUS_LABELS[status] ?? status}
      tone={TASK_TONES[status] ?? TASK_TONES.pending}
    />
  );
}

export function TicketStatusBadge({ status }: { status: TicketStatus | string }) {
  return (
    <Pill
      label={TICKET_STATUS_LABELS[status] ?? status}
      tone={TICKET_TONES[status] ?? TICKET_TONES.open}
    />
  );
}

export function PriorityPill({ priority }: { priority?: string | null }) {
  // Medium is the default — not worth a badge.
  if (!priority || priority === 'medium') return null;
  const tone = PRIORITY_TONES[priority] ?? PRIORITY_TONES.low;
  return <Pill label={`${PRIORITY_LABELS[priority] ?? priority} priority`} tone={tone} />;
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
});
