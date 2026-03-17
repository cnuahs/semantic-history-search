// URL utility functions

// 2026-03-16 - Shaun L. Cloherty <s.cloherty@ieee.org>

import normalizeUrl from "normalize-url";

// common tracking query parameters to strip
const TRACKING_PARAMS = [
  /^utm_\w+/i,  // Google Analytics
  'fbclid',     // Facebook
  'gclid',      // Google Ads
  'ref',        // generic referrer
  'source',     // generic source
  'mc_cid',     // Mailchimp campaign id
  'mc_eid',     // Mailchimp email id
];

export function normalize(url: string, options?: Partial<Parameters<typeof normalizeUrl>[1]>): string {
  return normalizeUrl(url, {
    stripHash: true,
    stripWWW: true,
    removeTrailingSlash: true,
    sortQueryParameters: true,
    removeQueryParameters: TRACKING_PARAMS,
    forceHttps: false,
    ...options,
  });
}
