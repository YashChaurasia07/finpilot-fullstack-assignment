import type { AccountStatus, GoalFlag, KycStatus, RiskLevel, Segment } from '../api/types';
import type { Priority, TransactionStatus, TransactionType } from './options';

export type Tone = 'slate' | 'green' | 'amber' | 'rose' | 'indigo' | 'sky';

/** Builds a lookup that must cover every value of the enum (the compiler checks this). */
const tones =
  <K extends string>(map: Record<K, Tone>) =>
  (key: K): Tone =>
    map[key];

/** Status colours are always paired with a text label, so meaning never depends on colour alone. */
export const kycTone = tones<KycStatus>({ VERIFIED: 'green', PENDING: 'amber', REVIEW: 'rose' });
export const segmentTone = tones<Segment>({ Mass: 'slate', Affluent: 'indigo', HNI: 'sky' });
export const accountStatusTone = tones<AccountStatus>({ ACTIVE: 'green', DORMANT: 'amber', CLOSED: 'slate' });
export const txStatusTone = tones<TransactionStatus>({ SETTLED: 'green', PENDING: 'amber', REVERSED: 'rose' });
export const txTypeTone = tones<TransactionType>({ BUY: 'indigo', SELL: 'sky', DIVIDEND: 'green', FEE: 'slate' });
export const priorityTone = tones<Priority>({ HIGH: 'rose', MEDIUM: 'amber', LOW: 'slate' });
export const flagTone = tones<GoalFlag>({ OVERDUE: 'rose', OVER_FUNDED: 'amber', COMPLETED: 'green' });
export const riskTone = tones<RiskLevel>({ Conservative: 'sky', Moderate: 'green', Growth: 'amber', Aggressive: 'rose' });

export const FLAG_LABEL: Record<GoalFlag, string> = { OVERDUE: 'Overdue', OVER_FUNDED: 'Over-funded (inconsistent)', COMPLETED: 'Completed' };
