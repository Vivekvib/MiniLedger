import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { Loan } from '../types/api';
import { formatInstantDate } from '../utils/dates';
import { colors, MAX_FONT_SCALE, radius, spacing, type } from '../theme';

type ChipLoan = Pick<Loan, 'status' | 'daysOverdue' | 'repaidAt'>;

/** The words on the chip. Every state is spelled out, so colour is never the only signal. */
export function statusLabel(loan: ChipLoan): string {
  switch (loan.status) {
    case 'overdue':
      return `Overdue · ${loan.daysOverdue} ${loan.daysOverdue === 1 ? 'day' : 'days'}`;
    case 'repaid':
      return loan.repaidAt ? `Repaid ${formatInstantDate(loan.repaidAt)}` : 'Repaid';
    default:
      return 'Outstanding';
  }
}

/** The same state as one plain sentence fragment for screen readers. */
export function statusSpoken(loan: ChipLoan): string {
  switch (loan.status) {
    case 'overdue':
      return `overdue by ${loan.daysOverdue} ${loan.daysOverdue === 1 ? 'day' : 'days'}`;
    case 'repaid':
      return loan.repaidAt ? `repaid on ${formatInstantDate(loan.repaidAt)}` : 'repaid';
    default:
      return 'outstanding';
  }
}

export function StatusChip({ loan }: { loan: ChipLoan }) {
  const color = loan.status === 'overdue' ? colors.overdue : loan.status === 'repaid' ? colors.accent : colors.textSecondary;
  return (
    <View style={[styles.chip, { borderColor: color }]} testID={`status-${loan.status}`}>
      {loan.status === 'repaid' ? <Ionicons name="checkmark" size={14} color={color} style={styles.icon} /> : null}
      <Text style={[type.label, { color }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {statusLabel(loan)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 24,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.chip,
  },
  icon: { marginRight: spacing.xs },
});
