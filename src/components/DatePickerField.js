import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from './theme';

/**
 * DatePickerField
 *
 * Props:
 *   value        — JS Date object (or null)
 *   onChange     — (Date) => void
 *   placeholder  — string shown when no date selected
 *   monthDayOnly — if true, only month+day matter (for annual dates like birthdays)
 *   label        — optional label above the field
 */
export function DatePickerField({ value, onChange, placeholder = 'Select date', monthDayOnly = false, label }) {
  const [show, setShow] = useState(false);

  const displayValue = () => {
    if (!value) return placeholder;
    if (monthDayOnly) {
      return value.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    }
    return value.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const handleChange = (event, selectedDate) => {
    setShow(false);
    if (event.type === 'dismissed') return;
    if (selectedDate) onChange(selectedDate);
  };

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.field} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {displayValue()}
        </Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display="spinner"
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13, fontWeight: '700', color: COLORS.subtext,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: 20, marginBottom: 6,
  },
  field: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: COLORS.border,
  },
  fieldText: { fontSize: 16, color: COLORS.text, fontWeight: '500' },
  placeholder: { color: '#aaa', fontWeight: '400' },
  icon: { fontSize: 18 },
});
