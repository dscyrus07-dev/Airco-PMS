import Constants from 'expo-constants';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/constants/colors';
import { useSession } from '@/stores/session';

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, company, signOut } = useSession();
  const [busy, setBusy] = useState(false);

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Sign out of AiROS Staff on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void signOut().finally(() => setBusy(false));
        },
      },
    ]);
  };

  const initials = (user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Screen>
      <Header title="Profile" />

      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name}>{user?.name ?? '—'}</Text>
          <Text style={styles.sub}>
            {user?.job_title || 'Staff'}
            {user?.username ? ` · @${user.username}` : ''}
          </Text>
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Contact</Text>
        <Row label="Email" value={user?.email} />
        <Row label="Phone" value={user?.phone} />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Workplace</Text>
        <Row label="Company" value={company?.brand_name ?? company?.name ?? user?.company_name} />
        <Row label="Role" value="Staff" />
      </Card>

      <Button
        label="Sign out"
        variant="outline"
        onPress={confirmSignOut}
        loading={busy}
        style={styles.signOut}
      />

      <Text style={styles.version}>
        AiROS Staff v{Constants.expoConfig?.version ?? '0.1.0'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  identityText: { flex: 1 },
  name: { fontSize: 19, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 3 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 14.5, color: colors.ink, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  signOut: { marginTop: 8 },
  version: { textAlign: 'center', fontSize: 12, color: colors.faint, marginTop: 24 },
});
