import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { colors } from '@/constants/colors';
import { useSession } from '@/stores/session';

/**
 * Employee area guard — this app is staff-only by design.
 * Management roles are sent to the web app; authorization itself always
 * stays server-side, this is just the product boundary.
 */
export default function EmployeeLayout() {
  const { status, user, signOut } = useSession();

  if (status === 'booting') {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (status !== 'signedIn') return <Redirect href="/login" />;

  if (user?.role !== 'employee') {
    return (
      <View style={styles.notice}>
        <View style={styles.noticeIcon}>
          <Ionicons name="desktop-outline" size={30} color={colors.infoInk} />
        </View>
        <Text style={styles.noticeTitle}>This app is for staff</Text>
        <Text style={styles.noticeBody}>
          AiROS Staff handles the employee workflow — tasks, checklists and maintenance
          tickets. Management screens live in the web app.
        </Text>
        <Button label="Sign out" variant="outline" onPress={() => void signOut()} />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 32,
    gap: 12,
  },
  noticeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  noticeTitle: { fontSize: 19, fontWeight: '700', color: colors.ink },
  noticeBody: { fontSize: 14.5, color: colors.muted, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
});
