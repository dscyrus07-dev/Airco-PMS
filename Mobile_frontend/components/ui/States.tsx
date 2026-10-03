import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { colors } from '@/constants/colors';
import { ApiError } from '@/services/api';

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function EmptyView({
  icon = 'clipboard-outline',
  title,
  body,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={30} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.isNetwork;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';
  return (
    <View style={styles.center}>
      <View style={[styles.iconCircle, styles.errorCircle]}>
        <Ionicons
          name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          size={30}
          color={colors.dangerInk}
        />
      </View>
      <Text style={styles.emptyTitle}>{offline ? 'No connection' : 'Something went wrong'}</Text>
      <Text style={styles.emptyBody}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="outline" onPress={onRetry} style={styles.retry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
    gap: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  errorCircle: { backgroundColor: colors.dangerSoft },
  loadingText: { fontSize: 14, color: colors.muted, marginTop: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 10, minWidth: 140 },
});
