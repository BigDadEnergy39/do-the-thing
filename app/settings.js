import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, Modal, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllCategories, createCategory, updateCategory, deleteCategory } from '../src/db/categories';
import { TimePickerField } from '../src/components/TimePickerField';
import { useRouter } from 'expo-router';
import { getSetting, setSetting, getAllSettings } from '../src/db/settings';
import { PERSONA_OPTIONS } from '../src/components/CoachText';
import { scheduleCoachingNotifications } from '../src/notifications/notificationService';
import notifee, { TriggerType } from '@notifee/react-native';
import { shareBackup, pickAndImportBackup, getLastAutoBackupInfo, saveAutoBackup } from '../src/db/backup';
import { COLORS } from '../src/components/theme';

const PRESET_COLORS = [
  '#e74c3c','#e67e22','#f39c12','#27ae60','#1abc9c',
  '#2980b9','#4a90d9','#9b59b6','#8e44ad','#95a5a6',
];

const INTENSITY_LABELS = {
  1: 'Minimal',
  2: 'Gentle',
  3: 'Balanced',
  4: 'Persistent',
  5: 'Maximum',
};

export default function SettingsScreen() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({});
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState(PRESET_COLORS[0]);
  const [lastBackup, setLastBackup] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const refresh = () => {
    setCategories(getAllCategories());
    setSettings(getAllSettings());
    getLastAutoBackupInfo().then(setLastBackup).catch(() => {});
  };

  useFocusEffect(React.useCallback(() => { refresh(); }, []));

  const updateSetting = (key, value) => {
    setSetting(key, value);
    setSettings(s => ({ ...s, [key]: String(value) }));
  };

  const handleSaveNotificationSettings = async () => {
    await scheduleCoachingNotifications();
    Alert.alert('Saved', 'Notification schedule updated.');
  };

  const handleTestNotification = async () => {
    try {
      await notifee.createTriggerNotification(
        {
          title: 'Do The Thing — Test',
          body: 'Notifications are working! Tap to go to your list.',
          data: { coaching: 'morning' },
          android: { channelId: 'briefing', pressAction: { id: 'default' } },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: Date.now() + 10_000,
          alarmManager: { allowWhileIdle: true },
        }
      );
      Alert.alert('Test scheduled', 'A notification will arrive in ~10 seconds. Background the app to see it.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const handleExport = async () => {
    setBackupBusy(true);
    try {
      await shareBackup();
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImport = () => {
    Alert.alert(
      'Import Backup',
      'This will replace ALL current tasks, categories, and settings with the backup file. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import', style: 'destructive', onPress: async () => {
            setBackupBusy(true);
            try {
              const result = await pickAndImportBackup();
              if (result.success) {
                Alert.alert('Import complete', 'All data has been restored. Restart the app to see your tasks.');
              }
            } catch (e) {
              Alert.alert('Import failed', e.message);
            } finally {
              setBackupBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleBackupNow = async () => {
    setBackupBusy(true);
    try {
      await saveAutoBackup();
      const info = await getLastAutoBackupInfo();
      setLastBackup(info);
      Alert.alert('Backup saved', 'A backup has been saved to your device.');
    } catch (e) {
      Alert.alert('Backup failed', e.message);
    } finally {
      setBackupBusy(false);
    }
  };

  // Category handlers
  const openAdd = () => { setEditingCat(null); setCatName(''); setCatColor(PRESET_COLORS[0]); setCatModalVisible(true); };
  const openEdit = (cat) => { setEditingCat(cat); setCatName(cat.name); setCatColor(cat.color); setCatModalVisible(true); };

  const handleSaveCat = () => {
    if (!catName.trim()) return;
    if (editingCat) updateCategory(editingCat.id, { name: catName.trim(), color: catColor });
    else createCategory(catName.trim(), catColor);
    setCatModalVisible(false);
    refresh();
  };

  const handleDeleteCat = (cat) => {
    Alert.alert('Delete Category', `Delete "${cat.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteCategory(cat.id); refresh(); } },
    ]);
  };

  const intensity = parseInt(settings.notification_intensity ?? '3', 10);
  const persona = settings.coach_persona ?? 'coach';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Manage Tasks ── */}
      <TouchableOpacity style={styles.allTasksBtn} onPress={() => router.push('/all-tasks')} activeOpacity={0.7}>
        <View style={styles.allTasksBtnInner}>
          <Text style={styles.allTasksBtnTitle}>View All Tasks</Text>
          <Text style={styles.allTasksBtnDesc}>Browse every active task — check for duplicates, tap to edit</Text>
        </View>
        <Text style={styles.allTasksArrow}>›</Text>
      </TouchableOpacity>

      {/* ── Coach Persona ── */}
      <Text style={styles.sectionHeader}>Coach Persona</Text>
      <Text style={styles.sectionDesc}>Choose how your coach talks to you.</Text>
      {PERSONA_OPTIONS.map(p => (
        <TouchableOpacity
          key={p.key}
          style={[styles.personaCard, persona === p.key && styles.personaCardSelected]}
          onPress={() => updateSetting('coach_persona', p.key)}
          activeOpacity={0.7}
        >
          <View style={styles.personaHeader}>
            <Text style={[styles.personaLabel, persona === p.key && styles.personaLabelSelected]}>
              {p.label}
            </Text>
            {persona === p.key && <Text style={styles.personaCheck}>✓</Text>}
          </View>
          <Text style={styles.personaDesc}>{p.desc}</Text>
          <View style={styles.personaSampleBox}>
            <Text style={styles.personaSampleLabel}>Sample:</Text>
            <Text style={styles.personaSample}>"{p.sample}"</Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* ── Notification Intensity ── */}
      <Text style={[styles.sectionHeader, styles.sectionSpacing]}>Notification Intensity</Text>
      <Text style={styles.sectionDesc}>How often should your coach check in?</Text>
      <View style={styles.intensityRow}>
        {[1, 2, 3, 4, 5].map(n => (
          <TouchableOpacity
            key={n}
            style={[styles.intensityBtn, intensity === n && styles.intensityBtnActive]}
            onPress={() => updateSetting('notification_intensity', n)}
          >
            <Text style={[styles.intensityNum, intensity === n && styles.intensityNumActive]}>{n}</Text>
            <Text style={[styles.intensityLabel, intensity === n && styles.intensityLabelActive]}>
              {INTENSITY_LABELS[n]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Timing ── */}
      <Text style={[styles.sectionHeader, styles.sectionSpacing]}>Daily Schedule</Text>
      <Text style={styles.sectionDesc}>Set your coaching cadence times (24h format, e.g. 07:00).</Text>

      {[
        { key: 'morning_briefing_time', label: 'Morning briefing' },
        { key: 'summary_time_1', label: 'Mid-day check-in' },
        { key: 'summary_time_2', label: 'Afternoon check-in' },
        { key: 'bedtime', label: 'Bedtime (daily wrap-up fires at this time)' },
        { key: 'weekly_review_time', label: 'Sunday weekly review time' },
      ].map(({ key, label }) => (
        <View key={key} style={styles.timeRow}>
          <Text style={styles.timeLabel}>{label}</Text>
          <TimePickerField
            value={settings[key] ?? null}
            onChange={v => updateSetting(key, v)}
            placeholder="Set time"
          />
        </View>
      ))}

      <TouchableOpacity style={styles.applyBtn} onPress={handleSaveNotificationSettings}>
        <Text style={styles.applyBtnText}>Apply Notification Schedule</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.testBtn} onPress={handleTestNotification}>
        <Text style={styles.testBtnText}>🔔 Send Test Notification (10s)</Text>
      </TouchableOpacity>

      {/* ── Categories ── */}
      <Text style={[styles.sectionHeader, styles.sectionSpacing]}>Categories</Text>
      <Text style={styles.sectionDesc}>Organize your tasks by category.</Text>

      {categories.map(cat => (
        <View key={cat.id} style={styles.catRow}>
          <View style={[styles.catDot, { backgroundColor: cat.color }]} />
          <Text style={styles.catName}>{cat.name}</Text>
          <TouchableOpacity onPress={() => openEdit(cat)} style={styles.catAction}>
            <Text style={styles.catActionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDeleteCat(cat)} style={styles.catAction}>
            <Text style={[styles.catActionText, { color: '#e74c3c' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.addCatBtn} onPress={openAdd}>
        <Text style={styles.addCatBtnText}>+ Add Category</Text>
      </TouchableOpacity>

      {/* ── Backup & Restore ── */}
      <Text style={[styles.sectionHeader, styles.sectionSpacing]}>Backup &amp; Restore</Text>
      <Text style={styles.sectionDesc}>
        Auto-backup runs daily in the background, keeping the last 7 days on your device.
        Use Export to save a copy somewhere safe.
      </Text>
      {lastBackup && (
        <View style={styles.backupInfoRow}>
          <Text style={styles.backupInfoText}>
            Last auto-backup: {lastBackup.filename.replace('dtt-backup-', '').replace('.json', '')}
          </Text>
        </View>
      )}
      <View style={styles.backupBtnRow}>
        <TouchableOpacity
          style={[styles.backupBtn, backupBusy && styles.backupBtnDisabled]}
          onPress={handleBackupNow}
          disabled={backupBusy}
        >
          <Text style={styles.backupBtnText}>💾 Backup Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.backupBtn, backupBusy && styles.backupBtnDisabled]}
          onPress={handleExport}
          disabled={backupBusy}
        >
          <Text style={styles.backupBtnText}>📤 Export</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.backupBtn, styles.backupBtnImport, backupBusy && styles.backupBtnDisabled]}
          onPress={handleImport}
          disabled={backupBusy}
        >
          <Text style={[styles.backupBtnText, styles.backupBtnImportText]}>📥 Import</Text>
        </TouchableOpacity>
      </View>

      {/* ── About ── */}
      <Text style={[styles.sectionHeader, styles.sectionSpacing]}>About</Text>
      <View style={styles.aboutCard}>
        <Text style={styles.aboutText}>Do The Thing  v1.0.0</Text>
        <Text style={styles.aboutDesc}>
          Your personal coach — keeping what matters front and center.
        </Text>
      </View>

      {/* Category modal */}
      <Modal visible={catModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{editingCat ? 'Edit Category' : 'New Category'}</Text>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={catName}
              onChangeText={setCatName}
              placeholder="e.g. Health"
              placeholderTextColor="#aaa"
              autoFocus
            />
            <Text style={styles.fieldLabel}>Color</Text>
            <View style={styles.colorRow}>
              {PRESET_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorSwatch, { backgroundColor: c }, catColor === c && styles.colorSwatchSelected]}
                  onPress={() => setCatColor(c)}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCat}>
              <Text style={styles.saveBtnText}>{editingCat ? 'Save' : 'Add'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setCatModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 60 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  sectionSpacing: { marginTop: 36 },
  sectionDesc: { fontSize: 14, color: COLORS.subtext, marginBottom: 14 },

  // Persona
  personaCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent',
  },
  personaCardSelected: { borderColor: COLORS.primary },
  personaHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  personaLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text, flex: 1 },
  personaLabelSelected: { color: COLORS.primary },
  personaCheck: { color: COLORS.primary, fontWeight: '700', fontSize: 16 },
  personaDesc: { fontSize: 13, color: COLORS.subtext, marginBottom: 8 },
  personaSampleBox: { backgroundColor: '#f4f6fb', borderRadius: 8, padding: 10 },
  personaSampleLabel: { fontSize: 11, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', marginBottom: 2 },
  personaSample: { fontSize: 14, color: COLORS.text, fontStyle: 'italic' },

  // Intensity
  intensityRow: { flexDirection: 'row', gap: 6 },
  intensityBtn: {
    flex: 1, padding: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
  },
  intensityBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  intensityNum: { fontSize: 18, fontWeight: '700', color: COLORS.subtext },
  intensityNumActive: { color: '#fff' },
  intensityLabel: { fontSize: 10, color: COLORS.subtext, marginTop: 2, textAlign: 'center' },
  intensityLabelActive: { color: '#fff' },

  // Timing
  timeRow: {
    flexDirection: 'column',
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  timeLabel: { fontSize: 14, color: COLORS.text, fontWeight: '500', marginBottom: 8 },
  applyBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4,
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  testBtn: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1,
    borderColor: COLORS.border, padding: 14, alignItems: 'center', marginTop: 4,
  },
  testBtnText: { color: COLORS.subtext, fontWeight: '600', fontSize: 14 },

  // Categories
  catRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8, gap: 12,
  },
  catDot: { width: 14, height: 14, borderRadius: 7 },
  catName: { flex: 1, fontSize: 16, color: COLORS.text, fontWeight: '500' },
  catAction: { paddingHorizontal: 4 },
  catActionText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  addCatBtn: {
    borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed',
    borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4,
  },
  addCatBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 15 },

  allTasksBtn: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 28,
  },
  allTasksBtnInner: { flex: 1 },
  allTasksBtnTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  allTasksBtnDesc: { fontSize: 13, color: COLORS.subtext },
  allTasksArrow: { fontSize: 24, color: '#ccc', marginLeft: 8 },

  backupInfoRow: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  backupInfoText: { fontSize: 13, color: COLORS.subtext },
  backupBtnRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  backupBtn: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  backupBtnImport: { borderColor: '#e74c3c22', backgroundColor: '#fff8f8' },
  backupBtnDisabled: { opacity: 0.5 },
  backupBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  backupBtnImportText: { color: '#e74c3c' },

  aboutCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  aboutText: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  aboutDesc: { fontSize: 14, color: COLORS.subtext, lineHeight: 20 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  input: {
    backgroundColor: '#f8f8f8', borderRadius: 10, padding: 14,
    fontSize: 16, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
  },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#fff', elevation: 4 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, color: COLORS.subtext },
});
