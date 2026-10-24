import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Banner, type BannerTone } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { ReceiptChooser } from '../../../components/ReceiptChooser';
import { ReceiptDraft } from '../../../components/ReceiptDraft';
import { Screen } from '../../../components/Screen';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { ErrorState, LoadingState } from '../../../components/ScreenStates';
import { TextButton } from '../../../components/TextButton';
import { useLoans, useReceiptImage, useRemoveReceipt, useUploadReceipt } from '../../../hooks/loans';
import { describeError } from '../../../services/api/errors';
import { colors, layout, MAX_FONT_SCALE, radius, spacing, type } from '../../../theme';
import { formatInstantDate } from '../../../utils/dates';
import { formatInr } from '../../../utils/money';
import { formatFileSize, receiptTypeLabel, type PickedReceipt } from '../../../utils/receipt';

interface Notice {
  tone: BannerTone;
  message: string;
}

/**
 * One loan's receipt: view it, add one, replace it, or remove it.
 *
 * Choosing a photo uploads it straight away. If the upload fails the photo is kept on screen and
 * "Try again" sends it again, so a bad connection never costs the user the photo.
 */
export default function ReceiptScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const loanId = Array.isArray(params.id) ? params.id[0] : params.id;

  const loansQuery = useLoans();
  const upload = useUploadReceipt();
  const remove = useRemoveReceipt();

  // The photo that is uploading or failed to upload. Cleared once it is saved or discarded.
  const [pending, setPending] = useState<PickedReceipt | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The photo downloaded fine but <Image> could not draw it.
  const [imageFailed, setImageFailed] = useState(false);

  const loan = loansQuery.data?.find((candidate) => candidate.id === loanId);
  const image = useReceiptImage(loan);
  const busy = upload.isPending || remove.isPending;

  const back = () => router.back();
  const header = <ScreenHeader title="Receipt" onBack={back} />;

  if (!loansQuery.data) {
    return (
      <Screen>
        {header}
        {loansQuery.isError ? (
          <ErrorState
            title="Couldn't load the loan"
            message={describeError(loansQuery.error, 'Something went wrong while loading.')}
            onRetry={() => void loansQuery.refetch()}
          />
        ) : (
          <LoadingState label="Loading…" />
        )}
      </Screen>
    );
  }

  if (!loan) {
    return (
      <Screen>
        {header}
        <View style={styles.missing} testID="loan-not-found">
          <Text style={[type.heading, styles.centered]} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Loan not found
          </Text>
          <Text style={[type.body, styles.centered]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            This loan is no longer in your list.
          </Text>
          <Button label="Back to loans" onPress={back} testID="back-to-loans" />
        </View>
      </Screen>
    );
  }

  const startUpload = (receipt: PickedReceipt) => {
    if (upload.isPending) return;
    setPending(receipt);
    setNotice(null);
    upload.mutate(
      { loanId: loan.id, receipt: { contentType: receipt.contentType, data: receipt.data } },
      {
        onSuccess: () => {
          setPending(null);
          setImageFailed(false);
          setNotice({ tone: 'success', message: loan.receipt ? 'Receipt replaced.' : 'Receipt saved.' });
        },
        onError: (error) =>
          setNotice({ tone: 'error', message: `The receipt was not uploaded. ${describeError(error, 'Please try again.')}` }),
      },
    );
  };

  const confirmRemove = () => {
    if (busy) return;
    Alert.alert('Remove this receipt?', 'The photo will be deleted from this loan.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setNotice(null);
          remove.mutate(loan.id, {
            onSuccess: () => setNotice({ tone: 'success', message: 'Receipt removed.' }),
            onError: (error) =>
              setNotice({ tone: 'error', message: `The receipt was not removed. ${describeError(error, 'Please try again.')}` }),
          });
        },
      },
    ]);
  };

  const failedUpload = pending !== null && !upload.isPending;
  const photoHeight = Math.max(240, Math.round(height * 0.5));

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.loanInfo}>
          <Text style={type.heading} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {loan.friendName}
          </Text>
          <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {formatInr(loan.amount)}
          </Text>
        </View>

        {notice ? (
          <Banner
            tone={notice.tone}
            message={notice.message}
            actionLabel={failedUpload ? 'Try again' : undefined}
            onAction={failedUpload && pending ? () => startUpload(pending) : undefined}
            onDismiss={() => {
              setNotice(null);
              if (failedUpload) setPending(null);
            }}
            testID="receipt-notice"
          />
        ) : null}

        {pending ? (
          <ReceiptDraft receipt={pending} label={upload.isPending ? 'Uploading…' : 'Not uploaded yet'} />
        ) : loan.receipt ? (
          <View style={styles.viewer}>
            {image.data ? (
              <Image
                key={image.dataUpdatedAt}
                source={{ uri: image.data }}
                style={[styles.image, { height: photoHeight }]}
                resizeMode="contain"
                onLoad={() => setImageFailed(false)}
                onError={() => setImageFailed(true)}
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Receipt photo for the loan to ${loan.friendName}`}
                testID="receipt-image"
              />
            ) : (
              <View style={[styles.image, styles.placeholder, { height: photoHeight }]} testID="receipt-image-loading">
                {image.isError ? null : <ActivityIndicator size="large" color={colors.accent} />}
                {image.isError ? null : (
                  <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    Loading receipt…
                  </Text>
                )}
              </View>
            )}
            {image.isError ? (
              <Banner
                tone="error"
                message={`Couldn't load the receipt photo. ${describeError(image.error, '')}`.trim()}
                actionLabel="Try again"
                onAction={() => void image.refetch()}
                testID="receipt-image-error"
              />
            ) : null}
            {imageFailed ? (
              <Banner
                tone="error"
                message="The photo was downloaded but could not be displayed."
                actionLabel="Try again"
                onAction={() => {
                  setImageFailed(false);
                  void image.refetch();
                }}
                testID="receipt-image-decode-error"
              />
            ) : null}
            <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE} testID="receipt-meta">
              {receiptTypeLabel(loan.receipt.contentType)} · {formatFileSize(loan.receipt.sizeBytes)} · Added{' '}
              {formatInstantDate(loan.receipt.uploadedAt)}
            </Text>
          </View>
        ) : (
          <Text style={type.body} maxFontSizeMultiplier={MAX_FONT_SCALE} testID="no-receipt">
            No receipt yet. Take a photo of it, or choose one from your gallery.
          </Text>
        )}

        <View style={styles.actions}>
          {loan.receipt ? (
            <Text style={[type.label]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Replace with another photo
            </Text>
          ) : null}
          <ReceiptChooser onPicked={startUpload} disabled={busy} testIDPrefix="receipt" />
          {loan.receipt && !pending ? (
            <View style={styles.removeRow}>
              <TextButton label="Remove receipt" onPress={confirmRemove} disabled={busy} testID="remove-receipt-button" />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  loanInfo: { gap: spacing.xs },
  viewer: { gap: spacing.md },
  image: {
    width: '100%',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  actions: { gap: spacing.md },
  removeRow: { marginLeft: -spacing.sm, alignSelf: 'flex-start' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: layout.gutter },
  centered: { textAlign: 'center' },
});
