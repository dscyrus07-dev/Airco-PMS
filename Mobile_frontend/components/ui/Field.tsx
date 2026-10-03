import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { colors } from '@/constants/colors';

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  /** Adds a show/hide toggle — use for passwords. */
  secure?: boolean;
}

export function Field({ label, error, secure, ...inputProps }: FieldProps) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error ? styles.inputError : null]}>
        <TextInput
          {...inputProps}
          style={[styles.input, inputProps.multiline && styles.multiline]}
          placeholderTextColor={colors.faint}
          secureTextEntry={secure ? hidden : inputProps.secureTextEntry}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.muted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.body, marginBottom: 7 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  inputError: { borderColor: colors.danger },
  input: {
    flex: 1,
    minHeight: 50,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 12,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  error: { fontSize: 12, color: colors.dangerInk, marginTop: 6 },
});
