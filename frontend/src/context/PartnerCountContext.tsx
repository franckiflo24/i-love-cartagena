import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../constants/api';

const PartnerCountContext = createContext<number>(0);

export const usePartnerCount = () => useContext(PartnerCountContext);

export function PartnerCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.get('/partners').then((p: any) => {
      if (Array.isArray(p) && p.length > 0) setCount(p.length);
    }).catch(() => {});
  }, []);

  return (
    <PartnerCountContext.Provider value={count}>
      {children}
    </PartnerCountContext.Provider>
  );
}
