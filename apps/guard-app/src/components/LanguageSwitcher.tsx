import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useLangStore } from '../store/langStore';
import { LANGUAGES } from '../i18n/translations';

// Three large, one-thumb language pills. Used on Login and in the Tools panel.
export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  return (
    <View style={styles.wrap}>
      {!compact && (
        <View style={styles.header}>
          <MaterialCommunityIcons name="translate" size={16} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.row}>
        {LANGUAGES.map((l) => {
          const active = l.code === lang;
          return (
            <TouchableOpacity key={l.code} style={styles.pillWrap} onPress={() => setLang(l.code)} activeOpacity={0.8}>
              {active ? (
                <LinearGradient colors={colors.gradientPrimary as [string, string]} style={styles.pill}>
                  <Text style={styles.pillTextActive}>{l.label}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.pill, styles.pillInactive]}>
                  <Text style={styles.pillText}>{l.label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm },
  pillWrap: { flex: 1 },
  pill: { paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillInactive: { borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
  pillText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  pillTextActive: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
