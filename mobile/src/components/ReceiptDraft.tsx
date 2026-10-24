import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, MAX_FONT_SCALE, radius, spacing, type } from '../theme';
import { formatFileSize, receiptTypeLabel, type PickedReceipt } from '../utils/receipt';
import { TextButton } from './TextButton';

interface ReceiptDraftProps {
  receipt: PickedReceipt;
  /** Shows a Remove link when given. */
  onRemove?: () => void;
  disabled?: boolean;
  /** The line above the type and size. */
  label?: string;
}

/** A small preview of the photo that is about to be uploaded, with its type and size and a Remove link. */
export function ReceiptDraft({ receipt, onRemove, disabled = false, label = 'Receipt attached' }: ReceiptDraftProps) {
  return (
    <View style={styles.row} testID="receipt-draft">
      <Image
        source={{ uri: receipt.uri }}
        style={styles.thumb}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        accessibilityLabel="Selected receipt photo"
      />
      <View style={styles.meta}>
        <Text style={type.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {label}
        </Text>
        <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {receiptTypeLabel(receipt.contentType)} · {formatFileSize(receipt.sizeBytes)}
        </Text>
      </View>
      {onRemove ? (
        <TextButton
          label="Remove"
          onPress={onRemove}
          disabled={disabled}
          accessibilityLabel="Remove the selected receipt photo"
          testID="receipt-draft-remove"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  meta: { flex: 1 },
});
