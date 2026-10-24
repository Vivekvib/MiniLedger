import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { ReceiptChooser } from '../../components/ReceiptChooser';
import { ReceiptDraft } from '../../components/ReceiptDraft';
import { FormScreen } from '../../components/FormScreen';
import { ScreenHeader } from '../../components/ScreenHeader';
import { TextField } from '../../components/TextField';
import { useFlash } from '../../context/FlashContext';
import { useAddLoan } from '../../hooks/loans';
import { describeError, isApiError } from '../../services/api/errors';
import { MAX_FONT_SCALE, spacing, type } from '../../theme';
import { defaultDueDate } from '../../utils/dates';
import { newIdempotencyKey } from '../../utils/idempotency';
import { sanitizeAmountInput } from '../../utils/money';
import type { PickedReceipt } from '../../utils/receipt';
import { FRIEND_NAME_MAX, validateLoanForm, type LoanFormErrors } from '../../utils/validation';

/** Record a new loan. On success it returns to the dashboard, which refetches the list and summary. */
export default function AddLoanScreen() {
  const router = useRouter();
  const { show } = useFlash();
  const addLoan = useAddLoan();

  const [friendName, setFriendName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDate, setDueDate] = useState(() => defaultDueDate());
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const amountRef = useRef<TextInputInstance>(null);

  // One Idempotency-Key per distinct submission. Pressing Save again after a failure (for
  // example a lost connection) re-sends the SAME key, so if the first attempt did reach the
  // server the user gets that loan back instead of a duplicate. Edited details get a new key.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const clearError = (field: keyof LoanFormErrors) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = () => {
    if (addLoan.isPending) return;
    setFormError(null);

    const result = validateLoanForm({ friendName, amountText, dueDate });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    const { input } = result;
    const signature = `${input.friendName}|${input.amount}|${input.dueDate}`;
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newIdempotencyKey() };
    }

    addLoan.mutate(
      {
        input,
        idempotencyKey: attempt.current.key,
        receipt: receipt ? { contentType: receipt.contentType, data: receipt.data } : null,
      },
      {
        onSuccess: ({ receiptError }) => {
          attempt.current = null;
          if (receiptError) {
            // The loan is saved; only the photo failed. Say so, and say where to retry.
            show(
              `Loan added: ${input.friendName}. The receipt could not be uploaded: ${describeError(receiptError, 'please try again.')} Choose "Add receipt" on the loan to try again.`,
              'error',
            );
          } else {
            show(receipt ? `Loan added with receipt: ${input.friendName}.` : `Loan added: ${input.friendName}.`);
          }
          router.back();
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'VALIDATION_ERROR') {
            const fields = error.fieldErrors;
            const mapped: LoanFormErrors = {
              friendName: fields.friendName,
              amount: fields.amount,
              dueDate: fields.dueDate,
            };
            setErrors(mapped);
            if (!mapped.friendName && !mapped.amount && !mapped.dueDate) setFormError(error.message);
          } else if (isApiError(error) && error.code === 'IDEMPOTENCY_KEY_REUSED') {
            attempt.current = null;
            setFormError('That attempt could not be completed. Press Save loan again.');
          } else {
            setFormError(describeError(error, "Couldn't save the loan. Please try again."));
          }
        },
      },
    );
  };

  const saving = addLoan.isPending;

  return (
    <FormScreen header={<ScreenHeader title="Add loan" onBack={() => router.back()} />}>
      {formError ? <Banner tone="error" message={formError} testID="form-error" /> : null}

      <TextField
        label="Friend's name"
        value={friendName}
        onChangeText={(text) => {
          setFriendName(text);
          clearError('friendName');
        }}
        error={errors.friendName}
        placeholder="Who did you lend to?"
        autoCapitalize="words"
        autoComplete="off"
        returnKeyType="next"
        maxLength={FRIEND_NAME_MAX}
        onSubmitEditing={() => amountRef.current?.focus()}
        editable={!saving}
        testID="friend-name-input"
      />

      <TextField
        inputRef={amountRef}
        label="Amount"
        prefix="₹"
        value={amountText}
        onChangeText={(text) => {
          setAmountText(sanitizeAmountInput(text));
          clearError('amount');
        }}
        error={errors.amount}
        hint="Up to 2 decimal places, for example 1500 or 1500.50."
        placeholder="0.00"
        keyboardType="decimal-pad"
        returnKeyType="done"
        maxLength={13}
        editable={!saving}
        testID="amount-input"
      />

      <DateField
        label="Due date"
        value={dueDate}
        onChange={(date) => {
          setDueDate(date);
          clearError('dueDate');
        }}
        error={errors.dueDate}
        testID="due-date-field"
      />

      <View style={styles.receiptField}>
        <Text style={[type.secondary, styles.receiptLabel]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Receipt photo (optional)
        </Text>
        {receipt ? <ReceiptDraft receipt={receipt} onRemove={() => setReceipt(null)} disabled={saving} /> : null}
        <ReceiptChooser onPicked={setReceipt} disabled={saving} testIDPrefix="add-receipt" />
      </View>

      <View style={styles.actions}>
        <Button label="Save loan" onPress={submit} loading={saving} testID="save-loan-button" />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={saving} testID="cancel-button" />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  receiptField: { gap: spacing.md },
  receiptLabel: { marginBottom: -spacing.xs },
  actions: { gap: spacing.md, marginTop: spacing.sm },
});
