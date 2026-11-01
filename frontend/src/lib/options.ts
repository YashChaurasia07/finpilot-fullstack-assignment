/** Value lists shared by forms, filters and types. They mirror the enums in the API. */
export const GOAL_TYPES = ['RETIREMENT', 'EDUCATION', 'HOME_PURCHASE', 'EMERGENCY_FUND', 'TRAVEL', 'WEALTH_CREATION'] as const;
export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const; // shown high to low
export const TX_TYPES = ['BUY', 'SELL', 'DIVIDEND', 'FEE'] as const;
export const TX_STATUSES = ['SETTLED', 'PENDING', 'REVERSED'] as const;

export type GoalType = (typeof GOAL_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type TransactionType = (typeof TX_TYPES)[number];
export type TransactionStatus = (typeof TX_STATUSES)[number];

const SPECIAL_LABELS: Record<string, string> = { ETF: 'ETF', REIT: 'REIT', GSEC: 'G-Sec', HNI: 'HNI', KYC: 'KYC' };

/** "HOME_PURCHASE" -> "Home purchase", "ETF" -> "ETF", "Mass" -> "Mass". */
export function humanize(value: string): string {
  if (SPECIAL_LABELS[value]) return SPECIAL_LABELS[value];
  const spaced = value.replace(/_/g, ' ');
  return spaced === spaced.toUpperCase() ? spaced.charAt(0) + spaced.slice(1).toLowerCase() : spaced;
}
