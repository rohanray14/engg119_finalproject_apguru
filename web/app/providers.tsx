"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { SWRConfig } from "swr";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { UserInfo } from "@/lib/types";

interface AppContextValue {
  user: UserInfo | null;
  loading: boolean;
}

const AppContext = createContext<AppContextValue>({ user: null, loading: true });

export function useAppUser() {
  return useContext(AppContext);
}

function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<UserInfo>("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppContext.Provider value={{ user, loading }}>
      {children}
    </AppContext.Provider>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const inner = (
    <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 5000 }}>
      <UserProvider>{children}</UserProvider>
    </SWRConfig>
  );

  // If no Clerk key (local dev), skip ClerkProvider
  if (!clerkKey) {
    return inner;
  }

  return <ClerkProvider publishableKey={clerkKey}>{inner}</ClerkProvider>;
}
