import { useOutletContext } from 'react-router';
import type { CustomerProfile } from '../api/types';

/** The customer tabs all share the profile loaded by CustomerLayout. */
export interface CustomerContext {
  customer: CustomerProfile;
}

export const useCustomerContext = () => useOutletContext<CustomerContext>();
