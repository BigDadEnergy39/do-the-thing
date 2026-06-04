import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAllCategories } from '../db/categories';

export function useCategories() {
  const [categories, setCategories] = useState([]);

  const refresh = useCallback(() => {
    setCategories(getAllCategories());
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return { categories, refresh };
}
