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
import {
  shareBackup, pickAndImportBackup, getLastAutoBackupInfo, saveAutoBackup,
  pickBackupFolder, clearBackupFolder, getDurableBackupStatus,
  listPrivateBackups, restoreFromPrivateFile,
} from '../src/db/backup';
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
  const [durableStatus, setDurableStatus] = useState({ uri: null, name: null, lastSuccess: null, stale: false });
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [privateBackups, setPrivateBackups] = useState([]);

  const refresh = () => {
    setCategories(getAllCategories());
    setSettings(getAllSettings());
    getLastAutoBackupInfo().then(setLastBackup).catch(() => {});
    setDurableStatus(getDurableBackupStatus());
    setNudgeDismissed(getSetting('backup_nudge_dismissed') === '1');
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
          android: { channelId: 'briefing', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
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
      const path = await saveAutoBackup();
      const info = await getLastAutoBackupInfo();
      setLastBackup(info);
      setDurableStatus(getDurableBackupStatus());
      // saveAutoBackup returns null when it skipped an empty database (nothing to save).
      if (path) Alert.alert('Backup saved', 'A backup has been saved to your device.');
      else Alert.alert('Nothing to back up', 'Add some tasks first — there\'s no data to back up yet.');
    } catch (e) {
      Alert.alert('Backup failed', e.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const handlePickFolder = async () => {
    setBackupBusy(true);
    try {
      const res = await pickBackupFolder();
      if (res.success) {
        // Write one backup immediately so the folder isn't empty and last-success is set,
        // giving instant confirmation the grant works. On an empty DB this safely no-ops
        // (returns null) — which is exactly what prevents a fresh install from writing an
        // empty backup here during disaster recovery.
        const path = await saveAutoBackup();
        setDurableStatus(getDurableBackupStatus());
        setLastBackup(await getLastAutoBackupInfo());
        Alert.alert(
          'Backup folder set',
          path
            ? 'Daily backups will now also be saved here, so they survive uninstalling the app.'
            : 'Backups will be saved here automatically once you have tasks. Your existing backups in this folder are untouched.'
        );
      }
    } catch (e) {
      Alert.alert('Could not set folder', e.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleClearFolder = () => {
    Alert.alert(
      'Stop off-device backups?',
      'Daily backups will no longer be copied to your chosen folder. Files already saved there are left untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: () => { clearBackupFolder(); setDurableStatus(getDurableBackupStatus()); } },
      ]
    );
  };

  const handleDismissNudge = () => {
    setSetting('backup_nudge_dismissed', '1');
    setNudgeDismissed(true);
  };

  const handleOpenRestore = async () => {
    try {
      setPrivateBackups(await listPrivateBackups());
      setRestoreVisible(true);
    } catch (e) {
      Alert.alert('Could not list backups', e.message);
    }
  };

  const handleRestoreFile = (file) => {
    Alert.alert(
      'Restore this backup?',
      `This replaces ALL current data with the backup from ${file.label}. Your current data is snapshotted first, so this can be undone via Import.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive', onPress: async () => {
            setBackupBusy(true);
            try {
              await restoreFromPrivateFile(file.filename);
              setRestoreVisible(false);
              Alert.alert('Restore complete', 'Your data has been restored. Restart the app to see it.');
            } catch (e) {
              Alert.alert('Restore failed', e.message);
            } finally {
              setBackupBusy(false);
            }
          },
        },
      ]
    );
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
        Choose a backup folder to also keep copies that survive uninstalling the app.
      </Text>

      {/* Nudge — shown only until a durable folder is chosen (or dismissed). */}
      {!durableStatus.uri && !nudgeDismissed && (
        <View style={styles.nudgeCard}>
          <TouchableOpacity
            style={styles.nudgeClose}
            onPress={handleDismissNudge}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.nudgeCloseText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.nudgeTitle}>⚠ Backups won't survive an uninstall</Text>
          <Text style={styles.nudgeBody}>
            Daily backups are saved inside the app, so they're lost if it's uninstalled or the
            phone is reset. Pick a folder — ideally a synced one (Nextcloud, Syncthing, SD card) —
            to keep safe copies.
          </Text>
          <TouchableOpacity style={styles.nudgeBtn} onPress={handlePickFolder} disabled={backupBusy}>
            <Text style={styles.nudgeBtnText}>📁 Choose backup folder</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Durable folder status — shown once a folder is set. */}
      {durableStatus.uri && (
        <View style={styles.folderCard}>
          <Text style={styles.folderLabel}>OFF-DEVICE FOLDER</Text>
          <Text style={styles.folderName}>{durableStatus.name}</Text>
          {durableStatus.stale ? (
            <Text style={styles.folderStale}>
              ⚠ Last off-device backup: {durableStatus.lastSuccess ?? 'never'} — the folder may be
              unavailable. Tap Change to re-select it.
            </Text>
          ) : (
            <Text style={styles.folderOk}>✓ Last off-device backup: {durableStatus.lastSuccess}</Text>
          )}
          <View style={styles.folderBtnRow}>
            <TouchableOpacity style={styles.folderBtn} onPress={handlePickFolder} disabled={backupBusy}>
              <Text style={styles.folderBtnText}>Change</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.folderBtn} onPress={handleClearFolder} disabled={backupBusy}>
              <Text style={[styles.folderBtnText, { color: '#e74c3c' }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {lastBackup && (
        <View style={styles.backupInfoRow}>
          <Text style={styles.backupInfoText}>
            Last auto-backup: {lastBackup.label}
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
      <TouchableOpacity
        style={[styles.restoreBtn, backupBusy && styles.backupBtnDisabled]}
        onPress={handleOpenRestore}
        disabled={backupBusy}
      >
        <Text style={styles.restoreBtnText}>🕘 Restore from a saved backup</Text>
      </TouchableOpacity>

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

      {/* Restore-from-list modal (no TextInput, so no KeyboardAvoidingView needed) */}
      <Modal visible={restoreVisible} transparent animationType="slide" onRequestClose={() => setRestoreVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Restore from a backup</Text>
            <Text style={styles.sectionDesc}>
              Pick a daily backup to restore. This replaces all current data (snapshotted first, so
              you can undo via Import). To restore after reinstalling, use Import and pick a file
              from your backup folder instead.
            </Text>
            {privateBackups.length === 0 ? (
              // After a reinstall, private storage is empty — but the durable folder's
              // backups are still recoverable via Import. Point the user there so an empty
              // list doesn't read as "your backups are gone".
              <Text style={styles.emptyText}>
                No on-device backups yet.{'\n\n'}To restore after reinstalling, close this and
                tap 📥 Import, then choose a file from your backup folder.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {privateBackups.map(file => (
                  <TouchableOpacity
                    key={file.filename}
                    style={styles.restoreRow}
                    onPress={() => handleRestoreFile(file)}
                    disabled={backupBusy}
                  >
                    <Text style={styles.restoreRowDate}>{file.label}</Text>
                    <Text style={styles.restoreRowArrow}>›</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRestoreVisible(false)}>
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
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

  // Durable-backup nudge
  nudgeCard: {
    backgroundColor: '#fff8ef', borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#e67e2244',
  },
  nudgeClose: { position: 'absolute', top: 8, right: 10, padding: 4, zIndex: 1 },
  nudgeCloseText: { fontSize: 15, color: COLORS.subtext, fontWeight: '700' },
  nudgeTitle: { fontSize: 15, fontWeight: '700', color: '#c0662a', marginBottom: 6, paddingRight: 20 },
  nudgeBody: { fontSize: 13, color: COLORS.text, lineHeight: 19, marginBottom: 12 },
  nudgeBtn: { backgroundColor: '#e67e22', borderRadius: 10, padding: 12, alignItems: 'center' },
  nudgeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Durable folder status card
  folderCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  folderLabel: { fontSize: 11, fontWeight: '700', color: COLORS.subtext, letterSpacing: 0.6, marginBottom: 4 },
  folderName: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  folderOk: { fontSize: 13, color: '#27ae60', marginBottom: 10 },
  folderStale: { fontSize: 13, color: '#e74c3c', lineHeight: 18, marginBottom: 10 },
  folderBtnRow: { flexDirection: 'row', gap: 8 },
  folderBtn: {
    flex: 1, backgroundColor: '#f4f6fb', borderRadius: 8, padding: 10, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  folderBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },

  // Restore-from-list
  restoreBtn: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, marginTop: 8,
  },
  restoreBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  restoreRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f8f8',
    borderRadius: 10, padding: 14, marginBottom: 8,
  },
  restoreRowDate: { flex: 1, fontSize: 15, color: COLORS.text, fontWeight: '500' },
  restoreRowArrow: { fontSize: 22, color: '#ccc' },
  emptyText: { fontSize: 14, color: COLORS.subtext, textAlign: 'center', paddingVertical: 20 },

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
