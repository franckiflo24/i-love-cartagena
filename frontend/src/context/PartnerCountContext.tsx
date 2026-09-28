import React, { createContext, useContext, useState, useEffect } from 'react';
import { getPartners } from '../lib/data';

const PartnerCountContext = createContext<number>(0);

export const usePartnerCount = () => useContext(PartnerCountContext);

// Catalog single-flight (launch sweep 2026-09-28): this provider used to fire
// its OWN `api.get('/partners')` (1.33 MB) on every app open, in parallel with
// Home's static catalog load — two full catalog downloads before first paint.
// It now joins the module-cached `getPartners()` from lib/data (the same
// promise/array Home reads), so a cold start downloads the catalog ONCE; any
// screen that later needs the LIVE list goes through `getPartnersOnce()` in
// constants/api, which is single-flight + cached too.
export function PartnerCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    getPartners().then((p) => {
      if (alive && Array.isArray(p) && p.length > 0) setCount(p.length);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <PartnerCountContext.Provider value={count}>
      {children}
    </PartnerCountContext.Provider>
  );
}
