import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { LoanRow } from '../../components/LoanRow';
import { Screen } from '../../components/Screen';
import { ScreenHeader } from '../../components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenStates';
import { SummaryTable } from '../../components/SummaryTable';
import { TextButton } from '../../components/TextButton';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useLoans, useRepayLoan, useSummary } from '../../hooks/loans';
import { describeError, isApiError } from '../../services/api/errors';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../../theme';
import type { Loan } from '../../types/api';
import { formatInr } from '../../utils/money';

interface LoanSection {
  title: string;
  data: Loan[];
}

/** The signed-in home: the server-computed summary on top, then every loan, then the Add loan bar. */
export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { flash, show, dismiss } = useFlash();
  const loansQuery = useLoans();
  const summaryQuery = useSummary();
  const repay = useRepayLoan();
  const [refreshing, setRefreshing] = useState(false);
  // Set synchronously (state would lag a render behind), so two quick confirmations cannot both go out.
  const repayInFlight = useRef(false);

  const loans = loansQuery.data;
  const summary = summaryQuery.data;
  const hasData = loans !== undefined && summary !== undefined;
  const failed = loansQuery.isError || summaryQuery.isError;
  const failure = loansQuery.error ?? summaryQuery.error;

  const refetchAll = () => Promise.all([loansQuery.refetch(), summaryQuery.refetch()]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setRefreshing(false);
    }
  };

  // Outstanding first (the server already puts overdue ones at the top), then repaid.
  const sections = useMemo<LoanSection[]>(() => {
    const all = loans ?? [];
    return [
      { title: 'Outstanding', data: all.filter((loan) => loan.status !== 'repaid') },
      { title: 'Repaid', data: all.filter((loan) => loan.status === 'repaid') },
    ].filter((section) => section.data.length > 0);
  }, [loans]);

  const confirmRepay = (loan: Loan) => {
    if (repayInFlight.current) return;
    Alert.alert('Mark as repaid?', `${loan.friendName} paid back ${formatInr(loan.amount)}. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark repaid',
        onPress: () => {
          if (repayInFlight.current) return;
          repayInFlight.current = true;
          repay.mutate(loan.id, {
            onSuccess: () => show(`Marked as repaid: ${loan.friendName}.`),
            onError: (error) => {
              if (isApiError(error) && error.status === 409) {
                show('That loan was already marked as repaid.', 'info');
              } else {
                show(describeError(error, "Couldn't mark the loan as repaid. Please try again."), 'error');
              }
            },
            onSettled: () => {
              repayInFlight.current = false;
            },
          });
        },
      },
    ]);
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', "You'll need a new verification code to sign in again.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const repayingId = repay.isPending ? repay.variables : null;

  let body;
  if (!hasData && failed) {
    body = (
      <ErrorState
        title="Couldn't load your loans"
        message={describeError(failure, 'Something went wrong while loading.')}
        onRetry={() => void refetchAll()}
      />
    );
  } else if (!hasData) {
    body = <LoadingState label="Loading your loans…" />;
  } else {
    body = (
      <SectionList
        sections={sections}
        // The list is a PureComponent: tell it that rows depend on which repayment is in flight.
        extraData={repayingId}
        keyExtractor={(loan) => loan.id}
        renderItem={({ item }) => (
          <LoanRow
            loan={item}
            onRepay={confirmRepay}
            onOpenReceipt={(loan) => router.push(`/receipt/${loan.id}`)}
            repaying={repayingId === item.id}
            disabled={repay.isPending}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={type.heading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {section.title}
            </Text>
            <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {section.data.length}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<SummaryTable summary={summary} />}
        ListEmptyComponent={
          <EmptyState
            title="No loans yet"
            message="Add one when you lend money, then mark it repaid when it comes back."
          />
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} colors={[colors.accent]} tintColor={colors.accent} />
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      <ScreenHeader title="MiniLedger" right={<TextButton label="Sign out" onPress={confirmSignOut} testID="sign-out-button" />} />

      {flash || (hasData && failed) ? (
        <View style={styles.banners}>
          {flash ? <Banner tone={flash.tone} message={flash.message} onDismiss={dismiss} testID="flash-banner" /> : null}
          {hasData && failed ? (
            <Banner
              tone="error"
              message={`Couldn't refresh. ${describeError(failure, '')}`.trim()}
              actionLabel="Try again"
              onAction={() => void refetchAll()}
              testID="refresh-error"
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.body}>{body}</View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}>
        <Button label="Add loan" onPress={() => router.push('/add-loan')} testID="add-loan-button" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  banners: { paddingHorizontal: layout.gutter, paddingBottom: spacing.sm, gap: spacing.sm },
  listContent: { paddingBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  bottomBar: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.rule,
    backgroundColor: colors.background,
  },
});
