// apps/guard-app/src/components/AnimatedEntry.tsx
import React from 'react';
import Animated, { FadeIn, SlideInLeft, SlideInRight, SlideInDown } from 'react-native-reanimated';

type Direction = 'left' | 'right' | 'up' | 'fade';

interface AnimatedEntryProps {
  children: React.ReactNode;
  delay?: number;
  direction?: Direction;
  duration?: number;
}

const animations = {
  left: SlideInLeft,
  right: SlideInRight,
  up: SlideInDown,
  fade: FadeIn,
};

export default function AnimatedEntry({
  children,
  delay = 0,
  direction = 'fade',
  duration = 400,
}: AnimatedEntryProps) {
  const Animation = animations[direction];

  return (
    <Animated.View entering={Animation.delay(delay).duration(duration).springify()}>
      {children}
    </Animated.View>
  );
}
