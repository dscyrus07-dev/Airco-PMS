import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TicketCard } from '@/components/maintenance/TicketCard';
import { Header } from '@/components/ui/Header';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/States';
import { colors } from '@/constants/colors';
import { useMyTickets } from '@/hooks/useData';
import { useSession } from '@/stores/session';
import type { MaintenanceTicket } from '@/types/api';

type Tab = 'active' | 'review' | 'done';

const ACTIVE: ReadonlySet<string> = new Set(['open', 'assigned', 'in_progress', 'on_hold']);
const REVIEW: ReadonlySet<string> = new Set(['resolved']);
// closed | cancelled → done

export default function MaintenanceScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { data: tickets, loading, refreshing, error, refresh } = useMyTickets();
  const [tab, setTab] = useState<Tab>('active');

  const buckets = useMemo(() => {
    const active: MaintenanceTicket[] = [];
    const review: MaintenanceTicket[] = [];
    const done: MaintenanceTicket[] = [];
    for (const t of tickets ?? []) {
      if (ACTIVE.has(t.status)) active.push(t);
      else if (REVIEW.has(t.status)) review.push(t);
      else done.push(t);
    }
    return { active, review, done };
  }, [tickets]);

  const options: SegmentOption<Tab>[] = [
    { key: 'active', label: 'Active', count: buckets.active.length },
    { key: 'review', label: 'Pending check', count: buckets.review.length },
    { key: 'done', label: 'Done', count: buckets.done.length },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.pad}>
        <Header
          title="Maintenance"
          right={
            <Pressable
              onPress={() => router.push('/maintenance/new')}
              style={styles.raise}
              accessibilityRole="button"
              accessibilityLabel="Raise a maintenance ticket"
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.raiseText}>Raise ticket</Text>
            </Pressable>
          }
        />
        <SegmentedControl options={options} value={tab} onChange={setTab} />
      </View>
      {loading && !tickets ? (
        <LoadingView label="Loading tickets…" />
      ) : error && !tickets ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : (
        <FlatList
          data={buckets[tab]}
          keyExtractor={(t) => t.ticket_uid}
          renderItem={({ item }) => (
            <TicketCard
              ticket={item}
              // Backend scopes the list to assigned-to-me OR reported-by-me —
              // anything not assigned to me is necessarily one I reported.
              mine={item.assigned_to !== user?.employee_uid}
            />
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
              icon="construct-outline"
              title={tab === 'active' ? 'No maintenance tickets' : 'Nothing here yet'}
              body={
                tab === 'active'
                  ? 'Tickets assigned to you — and ones you report — appear here.'
                  : undefined
              }
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
  raise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  raiseText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
});
