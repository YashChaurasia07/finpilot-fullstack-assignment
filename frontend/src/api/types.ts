/** Response shapes of the API (see backend/openapi.yaml). Money and quantities are exact decimal STRINGS. */
import type { GoalType, Priority, TransactionStatus, TransactionType } from '../lib/options';

export type Role = 'VIEWER' | 'ADMIN';
export type KycStatus = 'VERIFIED' | 'PENDING' | 'REVIEW';
export type Segment = 'Mass' | 'Affluent' | 'HNI';
export type AccountType = 'BROKERAGE' | 'MUTUAL_FUND' | 'RETIREMENT';
export type AccountStatus = 'ACTIVE' | 'DORMANT' | 'CLOSED';
export type AssetClass = 'EQUITY' | 'ETF' | 'MUTUAL_FUND' | 'BOND' | 'REIT' | 'GSEC';
export type RiskLevel = 'Conservative' | 'Moderate' | 'Growth' | 'Aggressive';
export type GoalFlag = 'OVERDUE' | 'OVER_FUNDED' | 'COMPLETED';

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

export interface Meta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface CustomerSummary {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  kycStatus: KycStatus;
  segment: Segment;
}

export interface RiskProfile {
  riskScore: number;
  riskLevel: RiskLevel;
  assessedAt: string;
  horizonYears: number;
  liquidityNeed: Priority;
}

export interface AccountInfo {
  accountId: string;
  accountType: AccountType;
  provider: string;
  status: AccountStatus;
  openedAt: string;
  baseCurrency: string;
}

export interface CustomerProfile extends CustomerSummary {
  dateOfBirth: string;
  onboardedAt: string;
  riskProfile: RiskProfile | null;
  accounts: AccountInfo[];
}

export interface PortfolioAccount {
  accountId: string;
  accountType: AccountType;
  provider: string;
  status: AccountStatus;
  openedAt: string;
  marketValue: string;
  costValue: string;
  unrealisedPnl: string;
  positionCount: number;
}

export interface Position {
  accountId: string;
  instrumentId: string;
  symbol: string;
  instrumentName: string;
  assetClass: AssetClass;
  quantity: string;
  avgCost: string;
  lastPrice: string;
  marketValue: string;
  costValue: string;
  unrealisedPnl: string;
  unrealisedPnlPct: string | null;
}

export interface Portfolio {
  customerId: string;
  asOf: { snapshotDate: string | null; priceDate: string | null };
  totals: { marketValue: string; costValue: string; unrealisedPnl: string; unrealisedPnlPct: string | null; positionCount: number };
  accounts: PortfolioAccount[];
  allocation: { assetClass: AssetClass; marketValue: string; weightPct: string }[];
  positions: Position[];
}

export interface Transaction {
  transactionId: string;
  accountId: string;
  instrumentId: string;
  symbol: string;
  instrumentName: string;
  transactionType: TransactionType;
  tradeDate: string;
  quantity: string;
  price: string;
  amount: string;
  status: TransactionStatus;
}

export interface Goal {
  goalId: string;
  customerId: string;
  goalType: GoalType;
  goalName: string;
  targetAmount: string;
  currentFundedAmount: string;
  targetDate: string;
  priority: Priority;
  fundedPct: number;
  flags: GoalFlag[];
}

/** Create sends every field; edit sends only the fields that changed. */
export interface GoalInput {
  goalType: GoalType;
  goalName: string;
  targetAmount: string;
  currentFundedAmount: string;
  targetDate: string;
  priority: Priority;
}

export interface InstrumentOption {
  instrumentId: string;
  symbol: string;
  instrumentName: string;
  assetClass: AssetClass;
}

export interface Rejection {
  rowNumber: number;
  recordKey: string | null;
  code: string;
  detail: string;
}

export interface ImportResult {
  batchId: number;
  fileName: string;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  truncated: boolean;
  rejections: Rejection[];
}
