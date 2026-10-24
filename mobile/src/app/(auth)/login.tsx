import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { FormScreen } from '../../components/FormScreen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { requestOtp } from '../../services/api/endpoints';
import { describeError, isApiError } from '../../services/api/errors';
import { colors, MAX_FONT_SCALE, spacing, type } from '../../theme';
import { normalizePhoneInput, PHONE_ERROR } from '../../utils/phone';

/** Step 1 of sign-in: enter a phone number, ask the backend to send a one-time code. */
export default function LoginScreen() {
  const router = useRouter();
  const { notice, clearNotice } = useAuth();
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const goToVerify = (normalizedPhone: string, resendAfterSeconds: number) =>
    router.push({ pathname: '/verify', params: { phone: normalizedPhone, resendAfter: String(resendAfterSeconds) } });

  const submit = async () => {
    if (submitting) return;
    clearNotice();
    setRequestError(null);

    const normalized = normalizePhoneInput(phone);
    if (!normalized) {
      setFieldError(PHONE_ERROR);
      return;
    }
    setFieldError(null);

    setSubmitting(true);
    try {
      const result = await requestOtp(normalized);
      goToVerify(normalized, result.resendAfterSeconds);
    } catch (error) {
      if (isApiError(error) && error.code === 'OTP_RESEND_TOO_SOON') {
        // A code was already sent a moment ago and is still valid: go and enter it.
        goToVerify(normalized, error.retryAfterSeconds ?? 60);
      } else {
        setRequestError(describeError(error, "Couldn't send the code. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormScreen>
      <View style={styles.intro}>
        <Text style={type.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          MiniLedger
        </Text>
        <Text style={type.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Keep track of money you lend to friends, and see when it comes back.
        </Text>
      </View>

      {notice ? <Banner tone="info" message={notice} onDismiss={clearNotice} testID="session-notice" /> : null}
      {requestError ? <Banner tone="error" message={requestError} testID="request-error" /> : null}

      <TextField
        label="Mobile number"
        value={phone}
        onChangeText={(text) => {
          setPhone(text);
          if (fieldError) setFieldError(null);
        }}
        error={fieldError}
        hint="We'll send a 6-digit code. A 10-digit number is treated as +91."
        placeholder="+91 12345 67890"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="send"
        maxLength={20}
        onSubmitEditing={() => void submit()}
        editable={!submitting}
        testID="phone-input"
      />

      <Button label="Send verification code" onPress={() => void submit()} loading={submitting} testID="send-code-button" />

      {__DEV__ ? (
        <Text style={[type.secondary, styles.devHint]} maxFontSizeMultiplier={MAX_FONT_SCALE} testID="dev-hint">
          Development build: this is mock sign-in. The code is printed in the terminal where the backend is running; it is
          not sent by SMS.
        </Text>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.sm },
  devHint: { color: colors.textSecondary },
});
