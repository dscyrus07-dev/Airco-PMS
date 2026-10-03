import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Pill, PriorityPill, TicketStatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { colors } from '@/constants/colors';
import type { MaintenanceTicket } from '@/types/api';
import { fmtDateIST } from '@/utils/format';

const TYPE_LABELS: Record<string, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  civil: 'Civil',
  carpentry: 'Carpentry',
  hvac: 'HVAC / AC',
  painting: 'Painting',
  furniture: 'Furniture',
  appliance: 'Appliance',
  internet: 'Internet / Network',
  water_drainage: 'Water / Drainage',
  cleaning_equipment: 'Cleaning Equipment',
  safety_security: 'Safety / Security',
  other: 'Other',
};

export function TicketCard({
  ticket,
  mine,
}: {
  ticket: MaintenanceTicket;
  /** true when the current employee reported this ticket. */
  mine?: boolean;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/maintenance/${ticket.ticket_uid}`)}
      accessibilityRole="button"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <TicketStatusBadge status={ticket.status} />
          <PriorityPill priority={ticket.priority} />
          {mine ? (
            <Pill label="Reported by you" tone={{ fg: colors.neutralInk, bg: colors.neutralSoft }} />
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {ticket.issue}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.muted} />
          <Text style={styles.meta} numberOfLines={1}>
            {ticket.location_label ?? 'Property'}
            {TYPE_LABELS[ticket.maintenance_type]
              ? ` · ${TYPE_LABELS[ticket.maintenance_type]}`
              : ` · ${ticket.maintenance_type}`}
          </Text>
        </View>
        {ticket.ticket_number ? (
          <View style={styles.metaRow}>
            <Ionicons name="pricetag-outline" size={13} color={colors.faint} />
            <Text style={styles.faint} numberOfLines={1}>
              {ticket.ticket_number}
              {ticket.created_at ? ` · ${fmtDateIST(ticket.created_at)}` : ''}
              {ticket.assigned_to_name ? ` · ${ticket.assigned_to_name}` : ''}
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, gap: 8 },
  pressed: { opacity: 0.75 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13.5, color: colors.muted, flexShrink: 1 },
  faint: { fontSize: 12.5, color: colors.faint, flexShrink: 1 },
});
