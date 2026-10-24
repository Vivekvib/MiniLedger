import { StyleSheet, Text, View } from 'react-native';
import type { Summary } from '../types/api';
import { formatInr, formatInrSpoken, isPositiveAmount } from '../utils/money';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../theme';

interface SummaryRowProps {
  label: string;
  value: string;
  size: 'display' | 'figure';
  labelColor?: string;
  valueColor?: string;
  testID: string;
  last?: boolean;
}

function SummaryRow({ label, value, size, labelColor = colors.textSecondary, valueColor = colors.text, testID, last }: SummaryRowProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${formatInrSpoken(value)}`}
      style={[styles.row, !last && styles.rowDivider]}
      testID={testID}
    >
      <Text style={[type.label, styles.label, { color: labelColor }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
      <Text
        style={[type[size], styles.value, { color: valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        testID={`${testID}-value`}
      >
        {formatInr(value)}
      </Text>
    </View>
  );
}

/**
 * The summary as a ruled table, the way a ledger shows totals: a heavy rule on top, hairlines
 * between rows, and a DOUBLE rule underneath (the bookkeeping mark for "this is the total").
 * The figures come straight from the server's /api/summary; nothing here adds anything up.
 */
export function SummaryTable({ summary }: { summary: Summary }) {
  const hasOverdue = isPositiveAmount(summary.overdueAmount);
  return (
    <View style={styles.table} testID="summary-table">
      <View style={styles.topRule} />
      <SummaryRow label="Total lent" value={summary.totalLent} size="display" testID="summary-total-lent" />
      <SummaryRow label="Total repaid" value={summary.totalRepaid} size="figure" testID="summary-total-repaid" />
      <SummaryRow
        label="Overdue"
        value={summary.overdueAmount}
        size="figure"
        labelColor={colors.overdue}
        valueColor={hasOverdue ? colors.overdue : colors.text}
        testID="summary-overdue"
        last
      />
      <View style={styles.doubleRule}>
        <View style={styles.ruleLine} />
        <View style={styles.ruleGap} />
        <View style={styles.ruleLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm },
  topRule: { height: layout.hairline, backgroundColor: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: { borderBottomWidth: layout.hairline, borderBottomColor: colors.rule },
  label: { flexShrink: 0 },
  value: { flexShrink: 1, textAlign: 'right' },
  doubleRule: { marginTop: 0 },
  ruleLine: { height: layout.hairline, backgroundColor: colors.text },
  ruleGap: { height: 3 },
});
