import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from './theme';

/**
 * TimePickerField
 *
 * Props:
 *   value       — "HH:MM" string (24h) or null
 *   onChange    — ("HH:MM") => void
 *   placeholder — string shown when no time selected
 *   label       — optional label above the field
 */
export function TimePickerField({ value, onChange, placeholder = 'Select time', label }) {
  const [show, setShow] = useState(false);

  // Convert "HH:MM" string to a Date object for the picker
  const toDate = (timeStr) => {
    const d = new Date();
    if (timeStr) {
      const [h, m] = timeStr.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    }
    return d;
  };

  // Convert a Date back to "HH:MM"
  const toTimeStr = (date) => {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  // Display in 12h format for readability
  const displayValue = () => {
    if (!value) return placeholder;
    const [h, m] = value.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };

  const handleChange = (event, selectedDate) => {
    setShow(false);
    if (event.type === 'dismissed') return;
    if (selectedDate) onChange(toTimeStr(selectedDate));
  };

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.field} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {displayValue()}
        </Text>
        <Text style={styles.icon}>🕐</Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display="spinner"
          is24Hour={false}
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
