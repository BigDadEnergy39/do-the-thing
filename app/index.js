import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Modal, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useDailyList } from '../src/hooks/useDailyList';
import { useCategories } from '../src/hooks/useCategories';
import { useLocations } from '../src/hooks/useLocations';
import { TaskCard } from '../src/components/TaskCard';
import { TimedGoalCard } from '../src/components/TimedGoalCard';
import { HabitCard } from '../src/components/HabitCard';
import { FastCapture } from '../src/components/FastCapture';
import { COLORS } from '../src/components/theme';
import { getSetting } from '../src/db/settings';
import { getCoachText } from '../src/components/CoachText';
import { CoachCard } from '../src/components/CoachCard';
import { createTask, undoCompletion } from '../src/db/tasks';
import { localDateTimeStr, localDateStr } from '../src/utils/date';

export default function TodayScreen() {
  const router = useRouter();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { mainItems, backlogItems, timedGoals, habits, completedToday, loading, refresh } = useDailyList();
  const [completedIds, setCompletedIds] = useState(new Set());
  const [backlogExpanded, setBacklogExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [fastCaptureVisible, setFastCaptureVisible] = useState(false);
  const [followUpTask, setFollowUpTask] = useState(null);
  const completePendingRef = useRef(null);

  // ── Filter + organize (view-only) ────────────────────────────────────────
  // Two independent axes: Category (life domain) and Location (where you can
  // act). Either, both, or neither may be filtered, and the list may be grouped
  // by one of them. Nothing here ever reorders: filtering HIDES, grouping
  // BUCKETS, and the coach's band-sort order survives both untouched.
  const { categories } = useCategories();
  const { locations } = useLocations();
  const [filterCatId, setFilterCatId] = useState(null);
  const [filterLocId, setFilterLocId] = useState(null);
  // Grouping is ONE axis at a time, not nested — nested buckets would need a
  // second heading level the app has no style for and would apply the
  // untagged-at-the-bottom rule twice.
  const [groupBy, setGroupBy] = useState('none');   // 'none' | 'category' | 'location'
  const scopeDayRef = useRef(null);

  const scopeActive = filterCatId != null || filterLocId != null || groupBy !== 'none';

  // Auto-clear on a new day so you can never wake up silently scoped and think
  // tasks vanished. Cold start clears it too, since this is in-memory session
  // state. Grouping resets alongside the filters because that is what the
  // forthcoming "Start each day clean" setting defaults to — step 6 makes this
  // configurable rather than changing the behavior.
  useFocusEffect(useCallback(() => {
    if (scopeActive && scopeDayRef.current !== localDateStr()) {
      setFilterCatId(null);
      setFilterLocId(null);
      setGroupBy('none');
    }
  }, [scopeActive]));

  // Any panel interaction stamps today, so the next day's first focus clears it.
  const stampScopeDay = () => { scopeDayRef.current = localDateStr(); };

  const selectCatFilter = (id) => {
    setFilterCatId(prev => (prev === id ? null : id));  // re-tapping clears
    stampScopeDay();
  };
  const selectLocFilter = (id) => {
    setFilterLocId(prev => (prev === id ? null : id));
    stampScopeDay();
  };
  const selectGroupBy = (mode) => { setGroupBy(mode); stampScopeDay(); };

  const clearScope = () => {
    setFilterCatId(null);
    setFilterLocId(null);
    setGroupBy('none');
    stampScopeDay();
  };

  // The panel is an in-screen overlay rather than an RN <Modal>, so hardware
  // back isn't handled for us — wire it up manually.
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    if (!panelVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPanelVisible(false);
      return true;   // consume it, so back doesn't also leave the screen
    });
    return () => sub.remove();
  }, [panelVisible]);

  // Keep tasks tagged with the selected value AND untagged tasks; hide only
  // tasks tagged to a *different* value. Applied per axis, so filtering both at
  // once narrows by both. Coach counts below stay on the UNFILTERED lists —
  // filtering must never change what the coach reports (protects the wrap-up
  // tier denominator).
  const matchesFilters = (t) =>
    (filterCatId == null || t.category_id == null || t.category_id === filterCatId) &&
    (filterLocId == null || t.location_id == null || t.location_id === filterLocId);

  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);

  const visibleMain = mainItems.filter(i => !completedIds.has(i.id));
  const visibleBacklog = backlogItems.filter(i => !completedIds.has(i.id));
  const totalRemaining = visibleMain.length + visibleBacklog.length;

  const shownMain = visibleMain.filter(matchesFilters);
  const shownBacklog = visibleBacklog.filter(matchesFilters);
  const shownTimedGoals = timedGoals.filter(matchesFilters);
  const shownHabits = habits.filter(matchesFilters);
  const shownCompleted = completedToday.filter(matchesFilters);

  // Grouping partitions the ALREADY-SORTED list in place: we walk shownMain in
  // its existing order and append. Nothing here sorts, which is what preserves
  // the coach's band-sort order inside every bucket by construction rather than
  // by care — see the "coach always owns sort" rule. Bucket order follows each
  // tag's own sort_order (the same order Settings lists them in), with untagged
  // LAST so nothing ever falls off the end unnoticed.
  //
  // Only this main list is bucketed ("Option A"); Goals, Habits, Backlog and
  // Completed keep their own sections. Note the deliberate asymmetry with
  // filtering, which applies to ALL sections — that is intended, not a bug.
  const mainGroups = (() => {
    if (groupBy === 'none') return null;
    const tags  = groupBy === 'category' ? categories : locations;
    const idKey = groupBy === 'category' ? 'category_id' : 'location_id';
    const buckets = tags.map(t => ({ key: `tag-${t.id}`, label: t.name, color: t.color, items: [] }));
    const untagged = {
      key: 'untagged',
      label: groupBy === 'category' ? 'Uncategorized' : 'No location',
      color: null,
      items: [],
    };
    const byId = new Map(tags.map((t, i) => [t.id, buckets[i]]));
    for (const item of shownMain) {
      // A task pointing at a deleted tag falls back to untagged rather than
      // vanishing. Foreign keys are off in this app, so strays are possible.
      const bucket = item[idKey] == null ? untagged : (byId.get(item[idKey]) ?? untagged);
      bucket.items.push(item);
    }
    return [...buckets, untagged].filter(b => b.items.length > 0);
  })();

  // Shared by the grouped and ungrouped paths so the card rendering can't drift.
  const renderCard = (item) => (
    item.has_timer
      ? <TimedGoalCard
          key={item.id}
          task={item}
          onComplete={handleComplete}
          onFollowUp={handleFollowUp}
          onChanged={refresh}
          onPress={(t) => router.push(`/task/${t.id}`)}
        />
      : <TaskCard
          key={item.id}
          task={item}
          onComplete={handleComplete}
          onFollowUp={handleFollowUp}
          onChanged={refresh}
          onPress={(t) => router.push(`/task/${t.id}`)}
        />
  );

  const handleComplete = (taskId) => {
    setCompletedIds(prev => new Set([...prev, taskId]));
    setTimeout(refresh, 400);
  };

  const handleUndo = (taskId) => {
    undoCompletion(taskId);
    setCompletedIds(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    refresh();
  };

  const handleFollowUp = (task, completeNow) => {
    completePendingRef.current = completeNow;
    setFollowUpTask(task);
  };

  const handleFollowUpChoice = (days) => {
    // Complete the original task
    completePendingRef.current?.();
    completePendingRef.current = null;

    // Create the follow-up task if an interval was chosen
    if (days > 0 && followUpTask) {
      const target = new Date();
      target.setDate(target.getDate() + days);
      target.setHours(0, 0, 0, 0);
      createTask({
        title: `Follow up: ${followUpTask.title}`,
        notes: followUpTask.notes ?? null,
        category_id: followUpTask.category_id ?? null,
        task_type: 'unscheduled',
        base_priority: followUpTask.base_priority,
        priority_ceiling: followUpTask.base_priority,
        snooze_until: localDateTimeStr(target),
        due_date: null, due_time: null,
        escalate_days_out: null, escalate_to_priority: null,
        recur_rule: null, recur_persistent: 0, recur_display_overdue: 0,
        rand_min_days: null, rand_max_days: null, rand_next_date: null, rand_persistent: 0,
        anchor_date: null, anchor_label: null,
        goal_minutes: null, goal_reset: 'daily',
        auto_hide_after_skips: null,
        preferred_time: followUpTask.preferred_time ?? null,
        habit_window: null,
      });
    }

    setFollowUpTask(null);
  };

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isEmpty = totalRemaining === 0 && timedGoals.length === 0 && habits.length === 0;

  const filterActive = filterCatId != null || filterLocId != null;
  const filterCatName = categories.find(c => c.id === filterCatId)?.name ?? '';
  const filterLocName = locations.find(l => l.id === filterLocId)?.name ?? '';
  // Reads "Office", "Health", or "Health · Office" when both axes are filtered.
  const filterName = [filterCatName, filterLocName].filter(Boolean).join(' · ');

  // The summary line's text. Filters name themselves; grouping is spelled out so
  // "Health" and "grouped by Category" can't be mistaken for the same kind of
  // thing. Reads e.g. "Health · Office · grouped by Category".
  const groupLabel = groupBy === 'none'
    ? null
    : `grouped by ${groupBy === 'category' ? 'Category' : 'Location'}`;
  const scopeSummary = [filterCatName, filterLocName, groupLabel].filter(Boolean).join(' · ');
  const filteredEmpty = filterActive &&
    shownMain.length === 0 && shownBacklog.length === 0 &&
    shownTimedGoals.length === 0 && shownHabits.length === 0;

  const criticalTitles = visibleMain
    .filter(t => t.effectivePriority >= 4)
    .map(t => t.title);

  const missedHabits = habits
    .filter(h => !h.checkinResponse)
    .map(h => h.title);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + bottomInset }]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />
        }
      >
        {/* Date header + the filter/organize affordance */}
        <View style={styles.header}>
          <Text style={styles.dateText}>{today}</Text>
          <TouchableOpacity
            style={[styles.organizeBtn, scopeActive && styles.organizeBtnActive]}
            onPress={() => setPanelVisible(true)}
            activeOpacity={0.7}
            accessibilityLabel="Filter and organize today"
          >
            <Text style={[styles.organizeIcon, scopeActive && styles.organizeIconActive]}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* Scope summary — the guarantee that you are never silently scoped.
            Shown for grouping too, even though grouping hides nothing: the panel
            is one control, and a line that reflected only half its state would
            confuse more than it clarified. Tapping it reopens the panel, since
            the line is the natural place to fix what it reports. */}
        {scopeActive && (
          <View style={styles.scopeBar}>
            <TouchableOpacity
              style={styles.scopeBarLabel}
              onPress={() => setPanelVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.scopeBarText} numberOfLines={1}>{scopeSummary}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearScope}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Clear filter and grouping"
            >
              <Text style={styles.scopeBarClear}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Coach card — persona-driven, time-aware */}
        {!loading && (
          <CoachCard
            remaining={totalRemaining}
            completedCount={completedToday.length}
            criticalTitles={criticalTitles}
            missedHabits={missedHabits}
            onPressWrapup={() => router.push('/review')}
          />
        )}

        {/* Empty state — genuinely nothing scheduled (only when unfiltered) */}
        {isEmpty && !filterActive && !loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✓</Text>
            <Text style={styles.emptyTitle}>{coach.allClear()}</Text>
          </View>
        )}

        {/* Filtered-empty — tasks exist, just none in this category. Never a
            blank screen that reads as "the app lost my tasks". */}
        {filteredEmpty && !loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing for {filterName} right now.</Text>
            <TouchableOpacity style={styles.clearFilterBtn} onPress={clearScope} activeOpacity={0.7}>
              <Text style={styles.clearFilterBtnText}>Show all tasks</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main task list — bucketed when grouping is on, otherwise flat. The
            bucket headers reuse the same section chrome as Goals/Habits/Backlog
            so grouping reads as the language the screen already speaks. */}
        {mainGroups
          ? mainGroups.map(group => (
              <View key={group.key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  {group.color && <View style={[styles.groupDot, { backgroundColor: group.color }]} />}
                  <Text style={styles.sectionTitle}>{group.label}</Text>
                  <Text style={styles.groupCount}>{group.items.length}</Text>
                </View>
                {group.items.map(renderCard)}
              </View>
            ))
          : shownMain.map(renderCard)}

        {/* Timed goals section */}
        {shownTimedGoals.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Goals</Text>
            </View>
            {shownTimedGoals.map(item => (
              <TimedGoalCard
                key={item.id}
                task={item}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
            ))}
          </View>
        )}

        {/* Habits section */}
        {shownHabits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Habits</Text>
            </View>
            {shownHabits.map(item => (
              <HabitCard
                key={item.id}
                task={item}
                checkinResponse={item.checkinResponse}
                streak={item.streak}
                targetProgress={item.targetProgress}
                onCheckin={refresh}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
            ))}
          </View>
        )}

        {/* Backlog section */}
        {shownBacklog.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => setBacklogExpanded(e => !e)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>Backlog</Text>
              <Text style={styles.sectionCount}>{shownBacklog.length}</Text>
              <Text style={styles.sectionChevron}>
                {backlogExpanded ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
            {backlogExpanded && shownBacklog.map(item => (
              item.has_timer
                ? <TimedGoalCard
                    key={item.id}
                    task={item}
                    onComplete={handleComplete}
                    onFollowUp={handleFollowUp}
                    onChanged={refresh}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
                : <TaskCard
                    key={item.id}
                    task={item}
                    onComplete={handleComplete}
                    onFollowUp={handleFollowUp}
                    onChanged={refresh}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
            ))}
          </View>
        )}

        {/* Completed today section */}
        {shownCompleted.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => setCompletedExpanded(e => !e)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>Completed</Text>
              <Text style={styles.sectionCount}>{shownCompleted.length}</Text>
              <Text style={styles.sectionChevron}>{completedExpanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {completedExpanded && shownCompleted.map(item => (
              <View key={item.id} style={styles.completedRow}>
                <TouchableOpacity
                  style={styles.completedMain}
                  onPress={() => router.push(`/task/${item.id}`)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.completedCheck}>✓</Text>
                  <View style={styles.completedBody}>
                    {item.category_name && (
                      <Text style={styles.completedCat}>{item.category_name}</Text>
                    )}
                    <Text style={styles.completedTitle}>{item.title}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.undoBtn}
                  onPress={() => handleUndo(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.undoBtnText}>Undo</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

      </ScrollView>

      {/* FAB row: fast capture (left) + full add (right) */}
      <View style={[styles.fabRow, { bottom: 28 + bottomInset }]}>
        <TouchableOpacity
          style={styles.fabSecondary}
          onPress={() => setFastCaptureVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.fabSecondaryText}>⚡</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/add')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>

      <FastCapture
        visible={fastCaptureVisible}
        onClose={() => setFastCaptureVisible(false)}
        onSaved={refresh}
      />

      {/* Follow-up prompt */}
      <Modal visible={!!followUpTask} transparent animationType="fade" onRequestClose={() => handleFollowUpChoice(0)}>
        <View style={styles.followUpOverlay}>
          <View style={styles.followUpSheet}>
            <Text style={styles.followUpTitle}>✓ Done!</Text>
            <Text style={styles.followUpBody}>Add a follow-up reminder?</Text>
            {[
              { label: 'In 3 days', days: 3 },
              { label: 'In 1 week', days: 7 },
              { label: 'In 2 weeks', days: 14 },
            ].map(({ label, days }) => (
              <TouchableOpacity
                key={days}
                style={styles.followUpBtn}
                onPress={() => handleFollowUpChoice(days)}
                activeOpacity={0.7}
              >
                <Text style={styles.followUpBtnText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.followUpSkip}
              onPress={() => handleFollowUpChoice(0)}
              activeOpacity={0.7}
            >
              <Text style={styles.followUpSkipText}>No follow-up needed</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Filter & organize panel — a plain in-screen overlay, NOT an RN <Modal>.
          A transparent Modal can leave a stuck, flickering ghost window on this
          Fabric build that no prop or mount tweak fixed; an absolutely-
          positioned View has no separate native window, so it can't ghost. It
          sits last inside the flex:1 container so it paints on top. Hardware
          back is wired manually above. */}
      {panelVisible && (
        <View style={[StyleSheet.absoluteFill, styles.panelRoot]}>
          {/* Backdrop flexes to fill everything above the sheet, rather than
              being absolutely positioned — this mirrors the modalOverlay
              structure already proven on the Settings editors, where the sheet
              is a normal flex child at the bottom of a dimmed flex:1 parent. */}
          <TouchableOpacity
            style={styles.panelBackdrop}
            activeOpacity={1}
            onPress={() => setPanelVisible(false)}
          />
          <View style={styles.panelSheet}>
            <Text style={styles.panelTitle}>Filter &amp; organize</Text>

            {/* Filtering HIDES. Both axes are independent, so a category and a
                location can be active at once. */}
            <Text style={styles.panelLabel}>Filter</Text>

            <Text style={styles.panelSubLabel}>Category</Text>
            <View style={styles.panelChipWrap}>
              <TouchableOpacity
                style={[styles.filterChip, filterCatId == null && styles.filterChipAllActive]}
                onPress={() => selectCatFilter(null)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, filterCatId == null && styles.filterChipTextActive]}>All</Text>
              </TouchableOpacity>
              {categories.map(cat => {
                const active = filterCatId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.filterChip, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                    onPress={() => selectCatFilter(cat.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{cat.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.panelSubLabel}>Location</Text>
            <View style={styles.panelChipWrap}>
              <TouchableOpacity
                style={[styles.filterChip, filterLocId == null && styles.filterChipAllActive]}
                onPress={() => selectLocFilter(null)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, filterLocId == null && styles.filterChipTextActive]}>Anywhere</Text>
              </TouchableOpacity>
              {locations.map(loc => {
                const active = filterLocId === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    style={[styles.filterChip, active && { backgroundColor: loc.color, borderColor: loc.color }]}
                    onPress={() => selectLocFilter(loc.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{loc.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Grouping BUCKETS — one axis at a time, never nested, and it never
                reorders anything inside a bucket. */}
            <Text style={styles.panelLabel}>Group by</Text>
            <View style={styles.panelChipWrap}>
              {[
                { key: 'none',     label: 'None'     },
                { key: 'category', label: 'Category' },
                { key: 'location', label: 'Location' },
              ].map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterChip, groupBy === key && styles.filterChipAllActive]}
                  onPress={() => selectGroupBy(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipText, groupBy === key && styles.filterChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.panelActions}>
              <TouchableOpacity
                style={styles.panelClearBtn}
                onPress={clearScope}
                disabled={!scopeActive}
                activeOpacity={0.7}
              >
                <Text style={[styles.panelClearText, !scopeActive && styles.panelClearTextOff]}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.panelDoneBtn}
                onPress={() => setPanelVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.panelDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  followUpOverlay: {
    flex: 1, backgroundColor: '#00000066',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  followUpSheet: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 24, width: '100%',
  },
  followUpTitle: { fontSize: 22, fontWeight: '700', color: COLORS.success, marginBottom: 4 },
  followUpBody: { fontSize: 16, color: COLORS.subtext, marginBottom: 20 },
  followUpBtn: {
    backgroundColor: COLORS.primary + '15', borderRadius: 12,
    padding: 14, alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  followUpBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.primary },
  followUpSkip: { padding: 12, alignItems: 'center', marginTop: 4 },
  followUpSkipText: { fontSize: 14, color: COLORS.subtext },

  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingTop: 8 },
  header: {
    paddingHorizontal: 20, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dateText: { fontSize: 14, color: COLORS.subtext, marginBottom: 4 },

  // Filter/organize affordance. The active tint is the "you are scoped" signal
  // that replaced the always-visible highlighted chip row — paired with the
  // summary line, so a filter can never be silently on.
  organizeBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff',
  },
  organizeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  organizeIcon: { fontSize: 16, color: COLORS.subtext },
  organizeIconActive: { color: '#fff' },

  // Grouping bucket headers — deliberately the same section chrome as
  // Goals/Habits/Backlog, plus the tag's colour dot and a count.
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupCount: { fontSize: 12, fontWeight: '700', color: COLORS.subtext },

  // Scope summary bar
  scopeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  scopeBarLabel: { flex: 1 },
  scopeBarText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  scopeBarClear: { fontSize: 15, fontWeight: '700', color: COLORS.primary },

  // Panel — mirrors the modalOverlay/modalSheet look used in Settings and Add so
  // it reads as the same kind of surface.
  // On Android, `elevation` takes part in z-ordering INDEPENDENTLY of sibling
  // order, so the elevated task cards and the elevation-6 FAB can paint over a
  // later sibling that has no elevation of its own. The overlay therefore needs
  // both an explicit zIndex and an elevation higher than anything beneath it —
  // being last in the tree is not sufficient on its own.
  panelRoot: { zIndex: 100, elevation: 100 },
  panelBackdrop: { flex: 1, backgroundColor: '#00000066' },
  panelSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  panelTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  panelLabel: {
    fontSize: 13, fontWeight: '700', color: COLORS.text,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 4,
  },
  panelSubLabel: { fontSize: 12, color: COLORS.subtext, marginTop: 10, marginBottom: 6 },
  panelChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panelActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24,
  },
  panelClearBtn: { paddingVertical: 12, paddingRight: 16 },
  panelClearText: { fontSize: 15, fontWeight: '600', color: COLORS.primary },
  panelClearTextOff: { color: COLORS.border },
  panelDoneBtn: {
    paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 12, backgroundColor: COLORS.primary,
  },
  panelDoneText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff',
  },
  filterChipAllActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 13, fontWeight: '600', color: COLORS.subtext },
  filterChipTextActive: { color: '#fff' },
  clearFilterBtn: {
    marginTop: 14, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 12, backgroundColor: COLORS.primary + '15',
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  clearFilterBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.primary },
  coachNudge: { fontSize: 15, color: COLORS.text, fontWeight: '500', lineHeight: 22 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12, color: COLORS.success },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, textAlign: 'center', paddingHorizontal: 32 },
  section: { marginTop: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, gap: 8,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.subtext,
    textTransform: 'uppercase', letterSpacing: 0.8, flex: 1,
  },
  sectionCount: { fontSize: 12, color: COLORS.subtext, fontWeight: '600' },
  sectionChevron: { fontSize: 11, color: COLORS.subtext },
  fabRow: {
    position: 'absolute', right: 24,
    flexDirection: 'row', gap: 12, alignItems: 'center',
  },
  fab: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', fontWeight: '300', lineHeight: 32 },
  fabSecondary: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  fabSecondaryText: { fontSize: 20 },
  completedRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 3,
    backgroundColor: '#fff', borderRadius: 10,
    overflow: 'hidden', opacity: 0.55,
  },
  completedMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  completedCheck: { fontSize: 14, color: COLORS.success, fontWeight: '700', marginRight: 10 },
  completedBody: { flex: 1 },
  completedCat: { fontSize: 10, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  completedTitle: { fontSize: 15, color: COLORS.text, fontWeight: '500', textDecorationLine: 'line-through' },
  undoBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderLeftWidth: 1, borderLeftColor: '#eee',
  },
  undoBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.subtext },
});
