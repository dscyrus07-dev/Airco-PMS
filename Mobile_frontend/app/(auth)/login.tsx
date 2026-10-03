import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/constants/colors';
import { ApiError } from '@/services/api';
import { useSession } from '@/stores/session';

export default function LoginScreen() {
  const { status, signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedIn') return <Redirect href="/tasks" />;

  const submit = async () => {
    if (!identifier.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
      // Session flips to signedIn — the guard above redirects to /tasks.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'Wrong email/username or password.'
            : err.message
          : 'Could not sign in. Please try again.'
      );
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.hero}>
          <View style={styles.mark}>
            <Text style={styles.markText}>A</Text>
          </View>
          <Text style={styles.app}>AiROS Staff</Text>
          <Text style={styles.tagline}>Sign in with your staff account</Text>
        </View>

        <Field
          label="Email or username"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="username"
          returnKeyType="next"
          placeholder="you@hotel.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          textContentType="password"
          autoComplete="password"
          returnKeyType="done"
          onSubmitEditing={submit}
          placeholder="••••••••"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label="Sign in"
          onPress={submit}
          loading={busy}
          disabled={!identifier.trim() || !password}
          variant="accent"
          style={styles.cta}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'center', paddingVertical: 32 },
  hero: { alignItems: 'center', marginBottom: 36 },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: '#FFFFFF', fontSize: 34, fontWeight: '800' },
  app: { fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: 16, letterSpacing: -0.3 },
  tagline: { fontSize: 14.5, color: colors.muted, marginTop: 6 },
  error: {
    fontSize: 13.5,
    color: colors.dangerInk,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cta: { marginTop: 4 },
});
