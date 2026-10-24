import { StyleSheet, Text, View } from 'react-native';
import type { Loan } from '../types/api';
import { formatDueDate } from '../utils/dates';
import { formatInr, formatInrSpoken } from '../utils/money';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../theme';
import { Button } from './Button';
import { StatusChip, statusSpoken } from './StatusChip';
import { TextButton } from './TextButton';

interface LoanRowProps {
  loan: Loan;
  onRepay: (loan: Loan) => void;
  /** Opens the receipt screen: view the photo, or add one when there is none. */
  onOpenReceipt: (loan: Loan) => void;
  /** True while this loan's repayment request is in flight. */
  repaying?: boolean;
  /** True while another loan's repayment is in flight: one repayment at a time. */
  disabled?: boolean;
}

/**
 * One flat ledger row, separated from the next by a hairline (no card, no shadow).
 * Overdue rows get a 3px red rule on the left AND the words "Overdue · N days" on the chip.
 * Every row reserves the same 3px on the left, so content stays aligned whatever the state.
 */
export function LoanRow({ loan, onRepay, onOpenReceipt, repaying = false, disabled = false }: LoanRowProps) {
  const overdue = loan.status === 'overdue';
  const spoken = `${loan.friendName}, ${formatInrSpoken(loan.amount)}, due ${formatDueDate(loan.dueDate)}, ${statusSpoken(loan)}${loan.receipt ? ', receipt attached' : ''}`;

  return (
    <View style={[styles.row, { borderLeftColor: overdue ? colors.overdue : 'transparent' }]} testID={`loan-${loan.id}`}>
      <View accessible accessibilityLabel={spoken} style={styles.summary}>
        <View style={styles.topLine}>
          <Text style={[type.heading, styles.name]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {loan.friendName}
          </Text>
          <Text
            style={[type.amount, styles.amount]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {formatInr(loan.amount)}
          </Text>
        </View>
        <View style={styles.metaLine}>
          <Text style={type.secondary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Due {formatDueDate(loan.dueDate)}
          </Text>
          <StatusChip loan={loan} />
        </View>
      </View>

      <View style={styles.actions}>
        {loan.status !== 'repaid' ? (
          <Button
            label="Mark repaid"
            variant="secondary"
            compact
            loading={repaying}
            disabled={disabled}
            onPress={() => onRepay(loan)}
            accessibilityLabel={`Mark the loan to ${loan.friendName} as repaid`}
            testID={`repay-${loan.id}`}
          />
        ) : null}
        <TextButton
          label={loan.receipt ? 'View receipt' : 'Add receipt'}
          onPress={() => onOpenReceipt(loan)}
          accessibilityLabel={
            loan.receipt ? `View the receipt for the loan to ${loan.friendName}` : `Add a receipt to the loan to ${loan.friendName}`
          }
          testID={`receipt-${loan.id}`}
        />
      </View>
    </View>
  );
}

const ROW_RULE = 3;

const styles = StyleSheet.create({
  row: {
    borderLeftWidth: ROW_RULE,
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.rule,
    paddingLeft: layout.gutter - ROW_RULE,
    paddingRight: layout.gutter,
    paddingVertical: spacing.lg,
  },
  summary: { gap: spacing.sm },
  topLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  name: { flex: 1 },
  amount: { flexShrink: 0, paddingTop: 2 },
  metaLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  actions: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
});
