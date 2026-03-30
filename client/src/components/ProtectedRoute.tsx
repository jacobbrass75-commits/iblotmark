import { type ReactNode } from "react";

// Auth removed — this is an internal tool. All routes are open.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
