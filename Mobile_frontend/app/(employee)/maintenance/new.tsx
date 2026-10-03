import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EvidencePicker, uploadedUrls, type EvidencePhoto } from '@/components/media/EvidencePicker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/States';
import { colors } from '@/constants/colors';
import { useEligibleLocations } from '@/hooks/useData';
import { ApiError } from '@/services/api';
import { createTicket } from '@/services/maintenance';
import { useSession } from '@/stores/session';

/** Same picklist the web raise-ticket flow offers — presentation only;
 *  the backend accepts any ≤64-char type string. */
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'civil', label: 'Civil' },
  { value: 'carpentry', label: 'Carpentry' },
  { value: 'hvac', label: 'HVAC / AC' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'internet', label: 'Wi-Fi / Network' },
  { value: 'water_drainage', label: 'Water / Drainage' },
  { value: 'safety_security', label: 'Safety' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

type Target =
  | { kind: 'room'; uid: string; label: string; zone: string | null }
  | { kind: 'dorm'; uid: string; label: string; zone: string | null };

export default function NewTicketScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { data, loading, error, refresh } = useEligibleLocations();

  const [target, setTarget] = useState<Target | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [issue, setIssue] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const targets = useMemo<Target[]>(() => {
    const rooms = (data?.rooms ?? []).map<Target>((r) => ({
      kind: 'room',
      uid: r.room_uid,
      label: `Room ${r.room_number}`,
      zone: r.zone_name,
    }));
    const dorms = (data?.dorms ?? []).map<Target>((d) => ({
      kind: 'dorm',
      uid: d.dorm_uid,
      label: d.name,
      zone: d.zone_name,
    }));
    return [...rooms, ...dorms];
  }, [data]);

  const uploadsSettled = uploadedUrls(photos);
  const canSubmit =
    !!target && !!type && issue.trim().length >= 3 && uploadsSettled !== null && !busy;

  const submit = async () => {
    if (!target || !type || !user?.property_uid) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const ticket = await createTicket({
        property_uid: user.property_uid,
        ...(target.kind === 'room' ? { room_uid: target.uid } : { dorm_uid: target.uid }),
        maintenance_type: type,
        issue: issue.trim(),
        description: description.trim() || undefined,
        priority,
        attachment_urls: uploadsSettled ?? [],
      });
      router.replace(`/maintenance/${ticket.ticket_uid}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Could not raise the ticket. Try again.'
      );
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Raise a ticket" back />

      {loading && !data ? (
        <LoadingView label="Loading locations…" />
      ) : error && !data ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : targets.length === 0 ? (
        <EmptyView
          icon="location-outline"
          title="No locations available"
          body="Your zone assignment doesn't cover any rooms or dorms — ask your supervisor to check your coverage."
        />
      ) : (
        <>
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Where is the problem?</Text>
            <ScrollView style={styles.targetList} nestedScrollEnabled>
              {targets.map((t) => {
                const active = target?.uid === t.uid;
                return (
                  <Pressable
                    key={t.uid}
                    onPress={() => setTarget(t)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.targetRow, active && styles.targetRowActive]}
                  >
                    <Ionicons
                      name={t.kind === 'room' ? 'bed-outline' : 'people-outline'}
                      size={18}
                      color={active ? colors.accentInk : colors.muted}
                    />
                    <Text style={[styles.targetLabel, active && styles.targetLabelActive]}>
                      {t.label}
                    </Text>
                    {t.zone ? <Text style={styles.targetZone}>{t.zone}</Text> : null}
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Type</Text>
            <View style={styles.chips}>
              {TYPE_OPTIONS.map((o) => {
                const active = type === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setType(o.value)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card style={styles.section}>
            <Field
              label="What's wrong?"
              value={issue}
              onChangeText={setIssue}
              placeholder="e.g. AC not cooling, tap leaking"
              maxLength={255}
            />
            <Field
              label="Details (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="Anything that helps the repair — sounds, smells, when it started"
              multiline
              maxLength={4000}
            />

            <Text style={styles.sectionTitle}>Priority</Text>
            <View style={styles.chips}>
              {PRIORITIES.map((o) => {
                const active = priority === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setPriority(o.value)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionTitle, styles.photoTitle]}>Photos (optional)</Text>
            <EvidencePicker
              photos={photos}
              onChange={setPhotos}
              max={4}
              hint="A photo of the issue helps the repair team find it faster."
            />
          </Card>

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          <Button
            label="Raise ticket"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            variant="accent"
            style={styles.submit}
          />
          {!canSubmit && !busy ? (
            <Text style={styles.hint}>
              {!target
                ? 'Pick a location first.'
                : !type
                  ? 'Pick a maintenance type.'
                  : issue.trim().length < 3
                    ? 'Describe the issue in a few words.'
                    : 'Wait for photo uploads to finish.'}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  targetList: { maxHeight: 260 },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  targetRowActive: { backgroundColor: colors.accentSoft },
  targetLabel: { fontSize: 15, fontWeight: '600', color: colors.body },
  targetLabelActive: { color: colors.accentInk },
  targetZone: { fontSize: 12.5, color: colors.faint, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  chipTextActive: { color: '#FFFFFF' },
  photoTitle: { marginTop: 4 },
  error: {
    fontSize: 13.5,
    color: colors.dangerInk,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  submit: { marginTop: 4 },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 10 },
});
