import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ToastContext = createContext(() => {});

/** useToast() → showToast(message). No-ops on empty/null messages. */
export const useToast = () => useContext(ToastContext);

/**
 * App-level toast: a brief message that slides up from the bottom and
 * auto-dismisses. Non-blocking (pointerEvents none), so it never gets in the way
 * of tapping. Used for completion acknowledgements — instant in-app feedback
 * instead of a system notification you'd have to clear.
 */
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;
  const hideTimer = useRef(null);
  const insets = useSafeAreaInsets();

  const showToast = useCallback((text) => {
    if (!text) return;
    clearTimeout(hideTimer.current);
    setMessage(text);
    opacity.setValue(0);
    translateY.setValue(24);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true })
        .start(() => setMessage(null));
    }, 2600);
  }, [opacity, translateY]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message != null && (
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { bottom: insets.bottom + 96, opacity, transform: [{ translateY }] }]}
        >
          <View style={styles.toast}>
            <Text style={styles.text}>{message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  toast: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
});
