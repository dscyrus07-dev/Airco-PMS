import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TaskCard } from '@/components/tasks/TaskCard';
import { Header } from '@/components/ui/Header';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/States';
import { colors } from '@/constants/colors';
import { useMyTasks } from '@/hooks/useData';
import { useSession } from '@/stores/session';
import type { Task } from '@/types/api';
import { effectiveStatus } from '@/utils/format';

type Tab = 'live' | 'review' | 'done';

const LIVE: ReadonlySet<string> = new Set([
  'pending',
  'assigned',
  'in_progress',
  'reopened',
  'overdue',
  'scheduled',
]);
const REVIEW: ReadonlySet<string> = new Set(['submitted']);
// everything else → done: completed | cancelled | abandoned

const EMPTY: Record<Tab, { title: string; body: string }> = {
  live: {
    title: 'No tasks assigned',
    body: 'New tasks appear here when they are assigned to you.',
  },
  review: {
    title: 'Nothing in review',
    body: 'Tasks you submit show up here until a supervisor approves them.',
  },
  done: {
    title: 'No finished tasks yet',
    body: 'Completed, cancelled and abandoned tasks collect here.',
  },
};

export default function TasksScreen() {
  const { user } = useSession();
  const { data, loading, refreshing, error, refresh } = useMyTasks();
  const [tab, setTab] = useState<Tab>('live');

  const buckets = useMemo(() => {
    const live: Task[] = [];
    const review: Task[] = [];
    const done: Task[] = [];
    for (const t of data?.tasks ?? []) {
      const s = effectiveStatus(t);
      if (LIVE.has(s)) live.push(t);
      else if (REVIEW.has(s)) review.push(t);
      else done.push(t);
    }
    return { live, review, done };
  }, [data]);

  const options: SegmentOption<Tab>[] = [
    { key: 'live', label: 'To do', count: buckets.live.length },
    { key: 'review', label: 'In review', count: buckets.review.length },
    { key: 'done', label: 'Done', count: buckets.done.length },
  ];

  const list = buckets[tab];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.pad}>
        <Header title="My Tasks" subtitle={user?.name ?? undefined} />
        <SegmentedControl options={options} value={tab} onChange={setTab} />
      </View>
      {loading && !data ? (
        <LoadingView label="Loading your tasks…" />
      ) : error && !data ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(t) => t.task_uid}
          renderItem={({ item }) => (
            <TaskCard task={item} zoneName={item.zone_uid ? data?.zones.get(item.zone_uid) : null} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyView
              icon={tab === 'live' ? 'clipboard-outline' : 'checkmark-done-outline'}
              title={EMPTY[tab].title}
              body={EMPTY[tab].body}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 20 },
  list: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
});
