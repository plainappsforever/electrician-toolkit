// True while the on-screen keyboard is open (v1.1, REVIEW_V1 #15): the strips above the forms show a visible "Done" then,
// because the iPhone decimal keyboard has no Done key below iOS 26 and a tap on the strip is the way to close it.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // iOS has the "will" events (the hint appears with the keyboard); Android only the "did" ones
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
