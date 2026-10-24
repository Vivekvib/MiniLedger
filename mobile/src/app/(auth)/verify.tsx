import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { FormScreen } from '../../components/FormScreen';
import { ScreenHeader } from '../../components/ScreenHeader';
import { TextButton } from '../../components/TextButton';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { requestOtp, verifyOtp } from '../../services/api/endpoints';
import { describeError, isApiError } from '../../services/api/errors';
import { MAX_FONT_SCALE, spacing, type } from '../../theme';
import { isValidOtp, OTP_ERROR, sanitizeOtpInput } from '../../utils/phone';

const DEFAULT_COOLDOWN_SECONDS = 60;

function parseSeconds(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : DEFAULT_COOLDOWN_SECONDS;
}

/** What to tell the user about a failed verification. */
function describeVerifyError(error: unknown): string {
  if (isApiError(error) && error.code === 'INVALID_OTP') {
    const left = error.attemptsRemaining;
    if (left !== null && left > 0 && error.details?.locked !== true) {
      return `${error.message} ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`;
    }
  }
  return describeError(error, "Couldn't verify the code. Please try again.");
}

/** Step 2 of sign-in: enter the code printed in the backend terminal. */
export default function VerifyScreen() {
  const router = useRouter();
  const { phone, resendAfter } = useLocalSearchParams<{ phone?: string; resendAfter?: string }>();
  const { signIn } = useAuth();

  const [otp, setOtp] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(() => parseSeconds(resendAfter));

  // Count the resend cooldown down once a second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Opened without a number (for example from a stale link): start over.
  if (!phone) return <Redirect href="/login" />;

  const verify = async () => {
    if (verifying) return;
    setError(null);
    setInfo(null);

    if (!isValidOtp(otp)) {
      setFieldError(OTP_ERROR);
      return;
    }
    setFieldError(null);

    setVerifying(true);
    try {
      const result = await verifyOtp(phone, otp);
      // Signing in flips the route guard, which moves the user to the dashboard.
      await signIn(result);
    } catch (e) {
      setError(describeVerifyError(e));
      if (isApiError(e) && e.status !== 0) setOtp('');
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (resending || cooldown > 0) return;
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const result = await requestOtp(phone);
      setOtp('');
      setFieldError(null);
      setCooldown(result.resendAfterSeconds);
      setInfo('A new code was sent. Earlier codes no longer work.');
    } catch (e) {
      if (isApiError(e) && e.retryAfterSeconds !== null) setCooldown(Math.ceil(e.retryAfterSeconds));
      setError(describeError(e, "Couldn't send a new code. Please try again."));
    } finally {
      setResending(false);
    }
  };

  return (
    <FormScreen header={<ScreenHeader title="Enter code" onBack={() => router.back()} />}>
      <Text style={type.body} maxFontSizeMultiplier={MAX_FONT_SCALE} testID="verify-intro">
        Enter the 6-digit code for {phone}.
      </Text>

      {error ? <Banner tone="error" message={error} testID="verify-error" /> : null}
      {info ? <Banner tone="success" message={info} testID="verify-info" /> : null}

      <TextField
        label="Verification code"
        value={otp}
        onChangeText={(text) => {
          setOtp(sanitizeOtpInput(text));
          if (fieldError) setFieldError(null);
        }}
        error={fieldError}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        returnKeyType="done"
        maxLength={6}
        onSubmitEditing={() => void verify()}
        editable={!verifying}
        testID="otp-input"
      />

      <Button label="Verify and sign in" onPress={() => void verify()} loading={verifying} testID="verify-button" />

      <View style={styles.links}>
        <TextButton label="Change number" onPress={() => router.back()} testID="change-number-button" />
        <TextButton
          label={cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Resend code'}
          onPress={() => void resend()}
          disabled={cooldown > 0 || resending}
          testID="resend-button"
        />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
});
