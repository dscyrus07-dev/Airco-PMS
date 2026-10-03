import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import type { ChecklistItem } from '@/types/api';

interface ChecklistProps {
  items: ChecklistItem[];
  /** Indexes of checked items (interactive mode). */
  checked: ReadonlySet<number>;
  onToggle?: (index: number) => void;
  /** Read-only render for completed/review states. */
  readOnly?: boolean;
}

/**
 * Renders the template checklist the backend resolved on the task detail.
 * Ticking items is a UI aid — the server remains authoritative on submit.
 */
export function Checklist({ items, checked, onToggle, readOnly }: ChecklistProps) {
  if (!items.length) return null;
  return (
    <View style={styles.wrap}>
      {items.map((item, i) => {
        const done = checked.has(i);
        const required = item.required !== false;
        return (
          <Pressable
            key={`${item.title}-${i}`}
            onPress={readOnly || !onToggle ? undefined : () => onToggle(i)}
            disabled={readOnly || !onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done, disabled: readOnly }}
            style={styles.row}
          >
            <View style={[styles.box, done && styles.boxDone]}>
              {done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
            </View>
            <View style={styles.flex}>
              <Text style={[styles.title, done && styles.titleDone]}>
                {item.title}
                {required ? <Text style={styles.required}> *</Text> : null}
              </Text>
              {item.description ? (
                <Text style={styles.desc}>{item.description}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** How many items are required — used to gate the submit button client-side. */
export const requiredChecklistIndexes = (items: ChecklistItem[]): number[] =>
  items.map((item, i) => (item.required === false ? -1 : i)).filter((i) => i >= 0);

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  flex: { flex: 1 },
  title: { fontSize: 15.5, color: colors.body, fontWeight: '500', lineHeight: 21 },
  titleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  required: { color: colors.danger, fontWeight: '700' },
  desc: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
});
