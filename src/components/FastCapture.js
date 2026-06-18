import React, { useState, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { createTask } from '../db/tasks';
import { COLORS } from './theme';

export function FastCapture({ visible, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef(null);

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) { onClose(); return; }
    createTask({ title: trimmed, task_type: 'unscheduled', base_priority: 2 });
    setTitle('');
    onSaved?.();
    onClose();
  };

  const handleClose = () => {
    setTitle('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={() => setTimeout(() => inputRef.current?.focus(), 50)}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          <Text style={styles.label}>Quick Add</Text>
          <Text style={styles.hint}>Title only — you can fill in details later.</Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What needs doing?"
            placeholderTextColor="#aaa"
            onSubmitEditing={handleSave}
            returnKeyType="done"
            autoCorrect
          />
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, !title.trim() && styles.saveBtnDisabled]}
              onPress={handleSave}
            >
              <Text style={styles.saveText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
    elevation: 20,
  },
  label: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  hint: { fontSize: 13, color: '#999', marginBottom: 16 },
  input: {
    backgroundColor: '#f4f6fb',
    borderRadius: 12,
    padding: 16,
    fontSize: 17,
    color: '#1a1a2e',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  btnRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  cancelText: { fontSize: 16, color: '#999', fontWeight: '600' },
  saveBtn: {
    flex: 2, padding: 14, borderRadius: 12,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { fontSize: 16, color: '#fff', fontWeight: '700' },
});
