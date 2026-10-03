import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap content in a ScrollView (default true). Lists render their own. */
  scroll?: boolean;
  contentStyle?: ViewStyle;
  edges?: Edge[];
}

export function Screen({ children, scroll = true, contentStyle, edges }: ScreenProps) {
  return (
    <SafeAreaView style={styles.root} edges={edges ?? ['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.content, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
});
