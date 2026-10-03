import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { EvidencePicker, uploadedUrls, type EvidencePhoto } from '@/components/media/EvidencePicker';
import { Pill, PriorityPill, TicketStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/States';
import { colors } from '@/constants/colors';
import { useTicket } from '@/hooks/useData';
import { ApiError, mediaUrl } from '@/services/api';
import { resolveTicket, startTicket } from '@/services/maintenance';
import { useSession } from '@/stores/session';
import { fmtDateTimeIST, ticketEventLabel } from '@/utils/format';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const { data: ticket, loading, error, refresh } = useTicket(id ?? '');

  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !ticket) {
    return (
      <Screen scroll={false}>
        <Header title="Ticket" back />
        <LoadingView label="Loading ticket…" />
      </Screen>
    );
  }
  if (error && !ticket) {
    return (
      <Screen scroll={false}>
        <Header title="Ticket" back />
        <ErrorView
          error={
            error instanceof ApiError && error.status === 403
              ? new ApiError(403, 'This ticket is not assigned to you.')
              : error
          }
          onRetry={refresh}
        />
      </Screen>
    );
  }
  if (!ticket) {
    return (
      <Screen scroll={false}>
        <Header title="Ticket" back />
        <EmptyView title="Ticket not found" body="It may have been closed or removed." />
      </Screen>
    );
  }

  const assignedToMe = ticket.assigned_to === user?.employee_uid;
  const canStart = ticket.status === 'assigned' && assignedToMe;
  const canResolve = ticket.status === 'in_progress' && assignedToMe;
  const uploadsSettled = uploadedUrls(photos);
  const events = [...(ticket.events ?? [])].sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? 1 : -1));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onStart = () => act(() => startTicket(ticket.ticket_uid));
  const onResolve = () => {
    const trimmed = notes.trim();
    if (trimmed.length < 3) {
      setActionError('Add a short note on what you did (at least 3 characters).');
      return;
    }
    act(() =>
      resolveTicket(ticket.ticket_uid, {
        resolution_notes: trimmed,
        photo_urls: uploadsSettled ?? [],
      })
    );
  };

  return (
    <Screen>
      <Header title={ticket.ticket_number ?? 'Ticket'} back />

      <View style={styles.badges}>
        <TicketStatusBadge status={ticket.status} />
        <PriorityPill priority={ticket.priority} />
        {/* Server scoping guarantees an employee only sees tickets assigned to
            them or reported by them — not assigned ⇒ they reported it. */}
        {!assignedToMe ? (
          <Pill label="Reported by you" tone={{ fg: colors.neutralInk, bg: colors.neutralSoft }} />
        ) : null}
      </View>
      <Text style={styles.title}>{ticket.issue}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={15} color={colors.muted} />
        <Text style={styles.meta}>{ticket.location_label ?? 'Property'}</Text>
      </View>
      {ticket.assigned_to_name ? (
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={15} color={colors.muted} />
          <Text style={styles.meta}>Assigned to {ticket.assigned_to_name}</Text>
        </View>
      ) : null}
      {ticket.reported_by_name ? (
        <View style={styles.metaRow}>
          <Ionicons name="flag-outline" size={15} color={colors.muted} />
          <Text style={styles.meta}>
            Reported by {ticket.reported_by_name}
            {ticket.created_at ? ` · ${fmtDateTimeIST(ticket.created_at)}` : ''}
          </Text>
        </View>
      ) : null}

      {ticket.description ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <Text style={styles.bodyText}>{ticket.description}</Text>
        </Card>
      ) : null}

      {(ticket.attachments?.length ?? 0) > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.evidenceRow}>
            {(ticket.attachments ?? []).map((a) => (
              <Image
                key={a.attachment_uid}
                source={{ uri: mediaUrl(a.url) }}
                style={styles.evidenceImg}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {ticket.resolution_notes ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Resolution</Text>
          <Text style={styles.bodyText}>{ticket.resolution_notes}</Text>
        </Card>
      ) : null}

      {/* Resolve form — only while assigned to me and in progress */}
      {canResolve ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Resolution</Text>
          <TextInput
            style={styles.noteInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="What did you do to fix it?"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={4000}
          />
          <Text style={[styles.sectionTitle, styles.photoTitle]}>Photos (optional)</Text>
          <EvidencePicker photos={photos} onChange={setPhotos} max={4} />
        </Card>
      ) : null}

      {/* Timeline */}
      {events.length > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {events.map((e) => (
            <View key={e.event_uid} style={styles.historyRow}>
              <View style={styles.historyDot} />
              <View style={styles.historyBody}>
                <Text style={styles.historyLabel}>{ticketEventLabel(e.action)}</Text>
                <Text style={styles.historyMeta}>
                  {e.at ? fmtDateTimeIST(e.at) : ''}
                  {e.actor_name ? ` · ${e.actor_name}` : ''}
                </Text>
                {e.comment ? <Text style={styles.historyNote}>{e.comment}</Text> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      <View style={styles.actions}>
        {canStart ? (
          <Button label="Start work" onPress={onStart} loading={busy} variant="accent" />
        ) : null}
        {canResolve ? (
          <Button
            label="Mark as resolved"
            onPress={onResolve}
            loading={busy}
            disabled={uploadsSettled === null || notes.trim().length < 3}
            variant="primary"
          />
        ) : null}
        {ticket.status === 'assigned' && !assignedToMe ? (
          <Text style={styles.hint}>
            Waiting for {ticket.assigned_to_name ?? 'an assignee'} to pick this up.
          </Text>
        ) : null}
        {ticket.status === 'resolved' ? (
          <Text style={styles.hint}>
            Resolved — a supervisor will check and close the ticket.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, lineHeight: 28, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  meta: { fontSize: 14, color: colors.muted },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  bodyText: { fontSize: 15, color: colors.body, lineHeight: 22 },
  noteInput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: colors.surfaceAlt,
    marginBottom: 4,
  },
  photoTitle: { marginTop: 10 },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  evidenceImg: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.neutralSoft },
  historyRow: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    marginTop: 6,
  },
  historyBody: { flex: 1 },
  historyLabel: { fontSize: 14.5, fontWeight: '600', color: colors.body },
  historyMeta: { fontSize: 12.5, color: colors.faint, marginTop: 1 },
  historyNote: { fontSize: 13.5, color: colors.muted, marginTop: 4, lineHeight: 19 },
  actionError: {
    fontSize: 13.5,
    color: colors.dangerInk,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
    overflow: 'hidden',
  },
  actions: { marginTop: 18, gap: 10 },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
});
