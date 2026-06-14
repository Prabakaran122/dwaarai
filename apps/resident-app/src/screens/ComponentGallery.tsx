import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { type } from '../theme/typography';
import { AppBar, Button, Card, StatusBadge, Input, SectionHeader, Avatar } from '../components/ui';
import PlateText from '../components/PlateText';

export default function ComponentGallery() {
  const [val, setVal] = useState('');
  return (
    <View style={styles.container}>
      <AppBar title="Components" bellCount={3} onBell={() => {}} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionHeader title="Typography" />
        <Text style={type.display}>Display 28</Text>
        <Text style={type.h1}>Heading 1</Text>
        <Text style={type.h2}>Heading 2</Text>
        <Text style={type.body}>Body regular 14</Text>
        <Text style={type.bodySecondary}>Body secondary 13</Text>
        <Text style={type.caption}>CAPTION 11</Text>

        <SectionHeader title="Buttons" />
        <View style={styles.gap}>
          <Button title="Open Gate" icon="gate" onPress={() => {}} />
          <Button title="Pre-approve" variant="ghost" onPress={() => {}} />
          <Button title="Deny" variant="destructive" onPress={() => {}} />
          <Button title="Loading" loading onPress={() => {}} />
          <Button title="Disabled" disabled onPress={() => {}} />
        </View>

        <SectionHeader title="Status badges" />
        <View style={styles.row}>
          <StatusBadge preset="granted" />
          <StatusBadge preset="denied" />
          <StatusBadge preset="pending" label="Waiting" />
          <StatusBadge preset="verified" />
          <StatusBadge preset="info" />
        </View>

        <SectionHeader title="Cards" />
        <Card style={styles.gap}><Text style={type.h3}>Default card</Text><Text style={type.bodySecondary}>White surface, hairline border.</Text></Card>
        <Card variant="hero" style={styles.gap}><Text style={[type.h3, { color: colors.textInverse }]}>Hero card</Text><Text style={{ color: colors.textInverse }}>Deep Ocean surface.</Text></Card>
        <Card accent={colors.success}><Text style={type.h3}>Accent card</Text></Card>

        <SectionHeader title="Input" />
        <Input label="Visitor name" placeholder="e.g. Rahul" value={val} onChangeText={setVal} />
        <View style={{ height: spacing.md }} />
        <Input label="With error" placeholder="Phone" error="Enter a valid number" />

        <SectionHeader title="Avatar + Plate" />
        <View style={styles.row}>
          <Avatar name="Prabakaran R" size="lg" />
          <Avatar name="Asha" size="md" />
          <PlateText plate="KA01AB1234" />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.mist },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['3xl'] },
  gap: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
