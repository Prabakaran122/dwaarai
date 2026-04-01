// apps/guard-app/src/components/GradientButton.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { radius } from '../theme/spacing';

type Variant = 'primary' | 'success' | 'danger';

interface GradientButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
}

const gradients: Record<Variant, readonly [string, string]> = {
  primary: colors.gradientPrimary,
  success: colors.gradientSuccess,
  danger: colors.gradientDanger,
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function GradientButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
}: GradientButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[animatedStyle, (disabled || loading) && { opacity: 0.5 }]}
      activeOpacity={0.9}
    >
      <LinearGradient
        colors={gradients[variant] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <View style={styles.content}>
            {icon && (
              <MaterialCommunityIcons name={icon} size={20} color={colors.white} style={styles.icon} />
            )}
            <Text style={styles.text}>{title}</Text>
          </View>
        )}
      </LinearGradient>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  gradient: {
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
