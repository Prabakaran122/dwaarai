import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { font } from '../../theme/typography';

type Variant = 'primary' | 'ghost' | 'destructive';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export default function Button({
  title, onPress, variant = 'primary', icon, loading = false, disabled = false, style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const fg = variant === 'ghost' ? colors.teal : colors.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'destructive' && styles.destructive,
        pressed && !isDisabled && styles.pressed,
        pressed && !isDisabled && variant === 'primary' && styles.primaryPressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {icon && <MaterialCommunityIcons name={icon} size={20} color={fg} style={styles.icon} />}
          <Text style={[styles.label, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48, minWidth: 120, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center',
  },
  primary: { backgroundColor: colors.actionPrimary },
  ghost: { backgroundColor: colors.transparent, borderWidth: 1, borderColor: colors.teal },
  destructive: { backgroundColor: colors.error },
  pressed: { transform: [{ scale: 0.97 }] },
  primaryPressed: { backgroundColor: colors.actionHover },
  disabled: { opacity: 0.4 },
  content: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: spacing.sm },
  label: { ...font(500), fontSize: 14 },
});
