import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { Checklist, requiredChecklistIndexes } from '@/components/checklist/Checklist';
import { EvidencePicker, uploadedUrls, type EvidencePhoto } from '@/components/media/EvidencePicker';
import { TaskStatusBadge, PriorityPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/States';
import { colors } from '@/constants/colors';
import { useTask } from '@/hooks/useData';
import { ApiError, mediaUrl } from '@/services/api';
import { startTask, submitTask } from '@/services/tasks';
import {
  effectiveStatus,
  fmtDateTimeIST,
  fmtTimeIST,
  hasClockTime,
  historyLabel,
  isExpired,
  taskLocation,
} from '@/utils/format';

const STARTABLE: ReadonlySet<string> = new Set(['pending', 'assigned', 'reopened']);

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: task, loading, error, refresh } = useTask(id ?? '');

  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const checklist = useMemo(() => task?.checklist ?? [], [task]);
  const requiredIdx = useMemo(() => requiredChecklistIndexes(checklist), [checklist]);
  const verification = task?.verification ?? null;
  const minPhotos = verification?.photo_required ? (verification.min_photos ?? 1) : 0;
  const maxPhotos = verification?.max_photos ?? 5;

  if (loading && !task) {
    return (
      <Screen scroll={false}>
        <Header title="Task" back />
        <LoadingView label="Loading task…" />
      </Screen>
    );
  }
  if (error && !task) {
    return (
      <Screen scroll={false}>
        <Header title="Task" back />
        <ErrorView
          error={
            error instanceof ApiError && error.status === 403
              ? new ApiError(403, 'This task is not assigned to you.')
              : error
          }
          onRetry={refresh}
        />
      </Screen>
    );
  }
  if (!task) {
    return (
      <Screen scroll={false}>
        <Header title="Task" back />
        <EmptyView title="Task not found" body="It may have been removed or reassigned." />
      </Screen>
    );
  }

  const status = effectiveStatus(task);
  const expired = isExpired(task);
  const startable = STARTABLE.has(task.status) && !expired;
  const working = task.status === 'in_progress' && !expired;
  const uploadsReady = uploadedUrls(photos);
  const photosOk =
    uploadsReady !== null && uploadsReady.length >= minPhotos && uploadsReady.length <= maxPhotos;
  const checklistOk = requiredIdx.every((i) => checked.has(i));
  const canSubmit = working && photosOk && checklistOk && !busy;
  const history = [...(task.history ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));

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

  const onStart = () => act(() => startTask(task.task_uid));
  const onSubmit = () => {
    const urls = uploadedUrls(photos) ?? [];
    act(() => submitTask(task.task_uid, { note: note.trim() || undefined, photo_urls: urls }));
  };

  const toggleCheck = (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChecked(next);
  };

  return (
    <Screen>
      <Header title={task.ticket_number ?? 'Task'} back />

      {/* Identity */}
      <View style={styles.badges}>
        <TaskStatusBadge status={status} />
        <PriorityPill priority={task.priority} />
        {expired && STARTABLE.has(task.status) ? (
          <Text style={styles.expiredNote}>This task has expired</Text>
        ) : null}
      </View>
      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={15} color={colors.muted} />
        <Text style={styles.meta}>{taskLocation(task)}</Text>
      </View>
      {task.scheduled_for ? (
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15} color={colors.muted} />
          <Text style={styles.meta}>
            {fmtTimeIST(task.scheduled_for)}
            {task.expires_at ? ` – due ${fmtTimeIST(task.expires_at)}` : ''}
          </Text>
        </View>
      ) : task.due_date ? (
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15} color={colors.muted} />
          <Text style={styles.meta}>
            {hasClockTime(task.due_date)
              ? `Due ${fmtDateTimeIST(task.due_date)}`
              : `Due today${task.due_time ? ` by ${task.due_time}` : ''}`}
          </Text>
        </View>
      ) : null}

      {task.status === 'reopened' ? (
        <View style={styles.reworkBanner}>
          <Ionicons name="return-up-back-outline" size={16} color={colors.amberInk} />
          <Text style={styles.reworkText}>
            Sent back for rework — check the history below for the reviewer&apos;s note.
          </Text>
        </View>
      ) : null}

      {task.description ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.bodyText}>{task.description}</Text>
        </Card>
      ) : null}

      {/* Checklist — rendered from the task's template config */}
      {checklist.length > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Checklist</Text>
          {working && verification?.checklist_required !== false ? (
            <Text style={styles.hint}>Tick items off as you finish them.</Text>
          ) : null}
          <Checklist
            items={checklist}
            checked={checked}
            onToggle={working ? toggleCheck : undefined}
            readOnly={!working}
          />
        </Card>
      ) : null}

      {/* Evidence + submit — only while the task is being worked */}
      {working ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Evidence</Text>
          <EvidencePicker
            photos={photos}
            onChange={setPhotos}
            max={maxPhotos}
            hint={
              minPhotos > 0
                ? `Attach at least ${minPhotos} photo${minPhotos > 1 ? 's' : ''} of the finished work.`
                : 'Photos are optional — attach them if they help the review.'
            }
          />
          <Text style={[styles.sectionTitle, styles.noteLabel]}>Note for the reviewer</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="Anything the supervisor should know (optional)"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={4000}
          />
        </Card>
      ) : null}

      {/* Submitted/completed evidence */}
      {task.status !== 'in_progress' && (task.completion_images?.length ?? 0) > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Submitted evidence</Text>
          <View style={styles.evidenceRow}>
            {(task.completion_images ?? []).map((img, i) => (
              <Image
                key={img.image_uid ?? `${img.url}-${i}`}
                source={{ uri: mediaUrl(img.url) }}
                style={styles.evidenceImg}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {/* Review state */}
      {task.status === 'submitted' ? (
        <View style={styles.reviewBanner}>
          <Ionicons name="hourglass-outline" size={16} color={colors.infoInk} />
          <Text style={styles.reviewText}>
            In review — a supervisor will approve it or send it back.
          </Text>
        </View>
      ) : null}

      {/* History */}
      {history.length > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>History</Text>
          {history.map((h) => (
            <View key={h.event_uid} style={styles.historyRow}>
              <View style={styles.historyDot} />
              <View style={styles.historyBody}>
                <Text style={styles.historyLabel}>{historyLabel(h.type)}</Text>
                <Text style={styles.historyMeta}>
                  {fmtDateTimeIST(h.at)}
                  {h.actor_name ? ` · ${h.actor_name}` : ''}
                </Text>
                {h.note ? <Text style={styles.historyNote}>{h.note}</Text> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      {/* Actions */}
      <View style={styles.actions}>
        {startable ? (
          <Button label="Start task" onPress={onStart} loading={busy} variant="accent" />
        ) : null}
        {working ? (
          <Button
            label="Submit for review"
            onPress={onSubmit}
            loading={busy}
            disabled={!canSubmit}
            variant="primary"
          />
        ) : null}
        {working && !canSubmit ? (
          <Text style={styles.submitHint}>
            {!photosOk
              ? minPhotos > 0
                ? `Upload ${minPhotos} photo${minPhotos > 1 ? 's' : ''} to submit.`
                : 'Wait for uploads to finish.'
              : 'Tick the required checklist items to submit.'}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  expiredNote: { fontSize: 12.5, color: colors.dangerInk, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, lineHeight: 28, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  meta: { fontSize: 14, color: colors.muted },
  reworkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.amberSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  reworkText: { fontSize: 13.5, color: colors.amberInk, flex: 1, lineHeight: 19 },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.infoSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  reviewText: { fontSize: 13.5, color: colors.infoInk, flex: 1, lineHeight: 19 },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 6 },
  bodyText: { fontSize: 15, color: colors.body, lineHeight: 22 },
  noteLabel: { marginTop: 16 },
  noteInput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: colors.surfaceAlt,
  },
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
  submitHint: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
