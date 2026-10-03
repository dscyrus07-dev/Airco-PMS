import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors } from '@/constants/colors';

type Variant = 'primary' | 'accent' | 'outline' | 'danger' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

const BG: Record<Variant, string> = {
  primary: colors.navy,
  accent: colors.accent,
  outline: 'transparent',
  danger: colors.danger,
  ghost: 'transparent',
};

const FG: Record<Variant, string> = {
  primary: '#FFFFFF',
  accent: '#FFFFFF',
  outline: colors.ink,
  danger: '#FFFFFF',
  ghost: colors.accentInk,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: BG[variant] },
        variant === 'outline' && styles.outline,
        inactive && styles.inactive,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={FG[variant]} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, { color: FG[variant] }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  outline: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  label: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  inactive: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
