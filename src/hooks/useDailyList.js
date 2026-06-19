import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { buildDailyList } from '../engine/scheduler';

export function useDailyList() {
  const [mainItems, setMainItems] = useState([]);
  const [backlogItems, setBacklogItems] = useState([]);
  const [timedGoals, setTimedGoals] = useState([]);
  const [habits, setHabits] = useState([]);
  const [completedToday, setCompletedToday] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    try {
      const result = buildDailyList();
      setMainItems(result.mainItems);
      setBacklogItems(result.backlogItems);
      setTimedGoals(result.timedGoals);
      setHabits(result.habits);
      setCompletedToday(result.completedToday);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Re-fetch when app comes back to foreground — useFocusEffect alone doesn't
  // fire on foreground resume if the screen was already focused.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { mainItems, backlogItems, timedGoals, habits, completedToday, loading, refresh };
}
