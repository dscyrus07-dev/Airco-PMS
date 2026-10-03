import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PriorityPill, TaskStatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { colors } from '@/constants/colors';
import type { Task } from '@/types/api';
import { effectiveStatus, fmtTimeIST, hasClockTime, taskLocation } from '@/utils/format';

interface TaskCardProps {
  task: Task;
  zoneName?: string | null;
}

/** Scheduled/due line — never fabricates a time for date-only dues. */
const scheduleLine = (task: Task): string | null => {
  if (task.scheduled_for) {
    const until = task.expires_at ? ` – due ${fmtTimeIST(task.expires_at)}` : '';
    return `Today ${fmtTimeIST(task.scheduled_for)}${until}`;
  }
  if (task.due_date) {
    if (hasClockTime(task.due_date)) return `Due ${fmtTimeIST(task.due_date)}`;
    if (task.due_time) return `Due by ${task.due_time}`;
    return 'Due today';
  }
  return null;
};

export function TaskCard({ task, zoneName }: TaskCardProps) {
  const router = useRouter();
  const status = effectiveStatus(task);
  const line = scheduleLine(task);
  const location = taskLocation(task, zoneName);

  return (
    <Pressable
      onPress={() => router.push(`/tasks/${task.task_uid}`)}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${TASK_STATUS_HINT[status] ?? status}`}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <TaskStatusBadge status={status} />
          <PriorityPill priority={task.priority} />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.muted} />
          <Text style={styles.meta} numberOfLines={1}>
            {location}
            {zoneName ? ` · ${zoneName}` : ''}
          </Text>
        </View>
        {line ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={colors.muted} />
            <Text style={[styles.meta, status === 'overdue' && styles.overdue]}>{line}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const TASK_STATUS_HINT: Record<string, string> = {
  in_progress: 'in progress',
  reopened: 'returned for rework',
  overdue: 'overdue',
};

const styles = StyleSheet.create({
  card: { marginBottom: 12, gap: 8 },
  pressed: { opacity: 0.75 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13.5, color: colors.muted, flexShrink: 1 },
  overdue: { color: colors.dangerInk, fontWeight: '600' },
});
