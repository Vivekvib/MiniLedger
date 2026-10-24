import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env';
import { toAppDate } from '../../utils/app-date';
import type { Clock } from '../../utils/clock';
import * as repo from './summary.repository';

export interface SummaryDto extends repo.SummaryTotals {
  currency: 'INR';
  /** The application date used as "today" for the overdue calculation, `YYYY-MM-DD`. */
  asOf: string;
  /** IANA zone that defines "today"; clients use it to derive date defaults. */
  timezone: string;
}

export function createSummaryService(deps: { pool: Pool; config: AppConfig; clock: Clock }) {
  return {
    async getSummary(userId: string): Promise<SummaryDto> {
      const asOf = toAppDate(deps.clock.now(), deps.config.appTimezone);
      const totals = await repo.getTotals(deps.pool, userId, asOf);
      return { ...totals, currency: 'INR', asOf, timezone: deps.config.appTimezone };
    },
  };
}

export type SummaryService = ReturnType<typeof createSummaryService>;
