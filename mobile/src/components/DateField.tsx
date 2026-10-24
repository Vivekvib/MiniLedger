import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, radius, spacing, type } from '../theme';
import { formatDueDate, toIsoDate } from '../utils/dates';

interface DateFieldProps {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  error?: string | null;
  testID?: string;
}

/** The server accepts due dates from 2000 to 2100; the native picker is limited to the same range. */
const MIN_DATE = new Date(2000, 0, 1);
const MAX_DATE = new Date(2100, 11, 31);

/**
 * A native date picker. Android opens the system dialog from a tappable row (the library's
 * recommended imperative API); iOS shows the system compact picker inline. Past dates are
 * allowed, since recording a loan that is already overdue is a normal use.
 */
export function DateField({ label, value, onChange, error, testID }: DateFieldProps) {
  const shown = formatDueDate(toIsoDate(value));
  const hasError = Boolean(error);

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate: MIN_DATE,
      maximumDate: MAX_DATE,
      onValueChange: (_event, date) => onChange(date),
    });
  };

  return (
    <View style={styles.wrapper}>
      <Text style={[type.secondary, styles.label]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
      {Platform.OS === 'ios' ? (
        <View style={[styles.box, hasError && styles.boxError]}>
          <DateTimePicker
            value={value}
            mode="date"
            display="compact"
            minimumDate={MIN_DATE}
            maximumDate={MAX_DATE}
            onValueChange={(_event, date) => onChange(date)}
            accessibilityLabel={label}
          />
        </View>
      ) : (
        <Pressable
          onPress={openAndroidPicker}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${shown}`}
          accessibilityHint="Opens a calendar to choose a date"
          testID={testID}
          style={({ pressed }) => [styles.box, hasError && styles.boxError, pressed && styles.pressed]}
        >
          <Text style={type.body} maxFontSizeMultiplier={MAX_FONT_SCALE} testID={testID ? `${testID}-value` : undefined}>
            {shown}
          </Text>
          <Text style={[type.secondary, styles.change]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Change
          </Text>
        </Pressable>
      )}
      {hasError ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={[type.secondary, styles.message]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  label: { color: colors.text, marginBottom: spacing.xs },
  box: {
    height: layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg - 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
  },
  boxError: { borderWidth: 2, borderColor: colors.overdue, paddingHorizontal: spacing.lg - 2 },
  pressed: { backgroundColor: colors.pressedFill },
  change: { color: colors.accent, textDecorationLine: 'underline' },
  message: { color: colors.overdue, marginTop: spacing.xs },
});
