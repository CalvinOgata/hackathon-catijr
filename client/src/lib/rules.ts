import type { ListingRules } from '@auction/shared';
import { api } from './api.ts';

let rules: Promise<ListingRules> | null = null;

/** The server's limits and rules (RF06), fetched once per page load. */
export function loadRules(): Promise<ListingRules> {
  rules ??= api.get<ListingRules>('/auctions/rules').catch((err) => {
    rules = null; // try again next time
    throw err;
  });
  return rules;
}
