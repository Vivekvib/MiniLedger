import { useState, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, radius, spacing, type } from '../theme';

interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'selectionColor' | 'accessibilityLabel'> {
  label: string;
  /** Validation message shown under the field. Also switches the border to the error treatment. */
  error?: string | null;
  hint?: string | null;
  /** Fixed text before the input, such as the rupee sign. */
  prefix?: string;
  inputRef?: Ref<TextInputInstance>;
}

/**
 * Label above, input below, message under that. Border: 1px at rest, 2px accent on focus,
 * 2px red with a message on error. The padding shrinks as the border grows, so the text never
 * moves when the border changes.
 */
export function TextField({ label, error, hint, prefix, inputRef, onFocus, onBlur, testID, ...inputProps }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);
  const borderWidth = hasError || focused ? 2 : 1;
  const borderColor = hasError ? colors.overdue : focused ? colors.accent : colors.inputBorder;

  return (
    <View style={styles.wrapper}>
      <Text style={[type.secondary, styles.label]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
      <View style={[styles.box, { borderWidth, borderColor, paddingHorizontal: spacing.lg - borderWidth }]}>
        {prefix ? (
          <Text style={[type.body, styles.prefix]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={inputRef}
          {...inputProps}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={hint ?? undefined}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.accent}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[type.body, styles.input]}
        />
      </View>
      {hasError ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={[type.secondary, styles.message, { color: colors.overdue }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={[type.secondary, styles.message]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {hint}
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
    backgroundColor: colors.surface,
    borderRadius: radius.control,
  },
  prefix: { marginRight: spacing.sm },
  input: { flex: 1, height: '100%', padding: 0 },
  message: { marginTop: spacing.xs },
});
