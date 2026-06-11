import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoading, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoading && !isSignedIn) {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      setLocation(`/sign-in?redirect_url=${encodeURIComponent(current)}`);
    }
  }, [isLoading, isSignedIn, setLocation]);

  if (isLoading) {
    return null;
  }

  if (!isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
