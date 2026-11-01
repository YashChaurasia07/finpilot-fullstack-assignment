import { count, eq, getTableColumns, ilike, or } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, customers, riskProfiles } from '../db/schema';
import { AppError } from '../lib/errors';

/** Escape LIKE wildcards so a search for "100%" or "a_b" matches literally instead of everything. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

const summary = {
  customerId: customers.customerId,
  fullName: customers.fullName,
  email: customers.email,
  phone: customers.phone,
  city: customers.city,
  state: customers.state,
  kycStatus: customers.kycStatus,
  segment: customers.segment,
};

/** Every customer-scoped endpoint starts here, so an unknown customer is always a clean 404. */
export async function requireCustomer(customerId: string): Promise<void> {
  const [row] = await db.select({ id: customers.customerId }).from(customers).where(eq(customers.customerId, customerId));
  if (!row) throw new AppError(404, 'NOT_FOUND', `Customer ${customerId} not found`);
}

export async function searchCustomers({ q, page, pageSize }: { q?: string; page: number; pageSize: number }) {
  const pattern = q ? `%${escapeLike(q)}%` : undefined;
  const where = pattern
    ? or(
        ilike(customers.customerId, pattern),
        ilike(customers.fullName, pattern),
        ilike(customers.email, pattern),
        ilike(customers.city, pattern),
      )
    : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(summary)
      .from(customers)
      .where(where)
      .orderBy(customers.fullName, customers.customerId)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(customers).where(where),
  ]);
  return { rows, total };
}

export async function getCustomerProfile(customerId: string) {
  const [[row], accountRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(customers),
        risk: {
          riskScore: riskProfiles.riskScore,
          riskLevel: riskProfiles.riskLevel,
          assessedAt: riskProfiles.assessedAt,
          horizonYears: riskProfiles.horizonYears,
          liquidityNeed: riskProfiles.liquidityNeed,
        },
      })
      .from(customers)
      .leftJoin(riskProfiles, eq(riskProfiles.customerId, customers.customerId))
      .where(eq(customers.customerId, customerId)),
    db
      .select({
        accountId: accounts.accountId,
        accountType: accounts.accountType,
        provider: accounts.provider,
        status: accounts.status,
        openedAt: accounts.openedAt,
        baseCurrency: accounts.baseCurrency,
      })
      .from(accounts)
      .where(eq(accounts.customerId, customerId))
      .orderBy(accounts.accountId),
  ]);
  if (!row) throw new AppError(404, 'NOT_FOUND', `Customer ${customerId} not found`);
  const { risk, ...customer } = row;
  // A customer is not guaranteed to have a risk profile or accounts: return null / [] instead of failing.
  return { ...customer, riskProfile: risk && risk.riskScore !== null ? risk : null, accounts: accountRows };
}
