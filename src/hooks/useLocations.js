import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAllLocations } from '../db/locations';

// Mirrors useCategories — refetches on screen focus so edits made in Settings
// show up immediately when you navigate back to Today or Add.
export function useLocations() {
  const [locations, setLocations] = useState([]);

  const refresh = useCallback(() => {
    setLocations(getAllLocations());
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return { locations, refresh };
}
