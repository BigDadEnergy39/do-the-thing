import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { buildDailyList } from '../engine/scheduler';

export function useDailyList() {
  const [mainItems, setMainItems] = useState([]);
  const [backlogItems, setBacklogItems] = useState([]);
  const [timedGoals, setTimedGoals] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    try {
      const result = buildDailyList();
      setMainItems(result.mainItems);
      setBacklogItems(result.backlogItems);
      setTimedGoals(result.timedGoals);
      setHabits(result.habits);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return { mainItems, backlogItems, timedGoals, habits, loading, refresh };
}
