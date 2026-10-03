import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { useSession } from '@/stores/session';

/** / → session-aware redirect. Boot splash while tokens are being read. */
export default function Index() {
  const { status } = useSession();

  if (status === 'booting') {
    return (
      <View style={styles.boot}>
        <View style={styles.mark}>
          <Text style={styles.markText}>A</Text>
        </View>
        <Text style={styles.name}>AiROS Staff</Text>
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      </View>
    );
  }
  return <Redirect href={status === 'signedIn' ? '/tasks' : '/login'} />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '700', color: colors.ink, marginTop: 14 },
  spinner: { marginTop: 18 },
});
