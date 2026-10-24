import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chooseReceiptPhoto, takeReceiptPhoto, type PickOutcome } from '../services/receipt-picker';
import { colors, MAX_FONT_SCALE, spacing, type } from '../theme';
import type { PickedReceipt } from '../utils/receipt';
import { Button } from './Button';

interface ReceiptChooserProps {
  /** Called with a photo that passed the phone-side checks (a real image, JPEG/PNG/WebP, 5 MB or less). */
  onPicked: (receipt: PickedReceipt) => void;
  /** Disables both buttons, e.g. while an upload is in flight. */
  disabled?: boolean;
  testIDPrefix?: string;
}

/**
 * Two ways to get a receipt photo: take one now, or choose one from the gallery. A photo that
 * can't be used (too big, not an image, camera not allowed) is explained in words under the
 * buttons; nothing is uploaded and nothing else on the screen is lost.
 */
export function ReceiptChooser({ onPicked, disabled = false, testIDPrefix = 'receipt' }: ReceiptChooserProps) {
  const [busy, setBusy] = useState<'camera' | 'gallery' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Set synchronously: a second tap in the same frame must not open a second picker.
  const opening = useRef(false);

  const run = async (kind: 'camera' | 'gallery', pick: () => Promise<PickOutcome>) => {
    if (opening.current) return;
    opening.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      const outcome = await pick();
      if (outcome.status === 'picked') onPicked(outcome.receipt);
      else if (outcome.status === 'error') setMessage(outcome.message);
    } finally {
      opening.current = false;
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.buttons}>
        <Button
          label="Take photo"
          variant="secondary"
          compact
          loading={busy === 'camera'}
          disabled={disabled || busy === 'gallery'}
          onPress={() => void run('camera', takeReceiptPhoto)}
          testID={`${testIDPrefix}-camera-button`}
        />
        <Button
          label="Choose from gallery"
          variant="secondary"
          compact
          loading={busy === 'gallery'}
          disabled={disabled || busy === 'camera'}
          onPress={() => void run('gallery', chooseReceiptPhoto)}
          testID={`${testIDPrefix}-gallery-button`}
        />
      </View>
      {message ? (
        <Text
          style={[type.secondary, styles.message]}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID={`${testIDPrefix}-picker-error`}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  message: { color: colors.overdue },
});
