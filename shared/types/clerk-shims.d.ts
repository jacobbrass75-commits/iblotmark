declare module "@clerk/clerk-react" {
  import * as React from "react";

  export interface ClerkEmailAddress {
    emailAddress?: string | null;
    verification?: {
      status?: string | null;
    } | null;
  }

  export interface ClerkUser {
    id: string;
    username?: string | null;
    firstName: string | null;
    lastName: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    primaryEmailAddress?: ClerkEmailAddress | null;
    publicMetadata?: Record<string, unknown>;
  }

  export function useAuth(): {
    isLoaded: boolean;
    isSignedIn?: boolean | null;
    userId?: string | null;
  };

  export function useUser(): {
    isLoaded: boolean;
    user: ClerkUser | null;
  };

  export function useClerk(): {
    signOut: () => void | Promise<void>;
  };

  export const ClerkProvider: React.ComponentType<{
    children?: React.ReactNode;
    publishableKey?: string;
    afterSignOutUrl?: string;
  }>;

  export const SignIn: React.ComponentType<{
    routing?: string;
    path?: string;
    signUpUrl?: string;
  }>;

  export const SignUp: React.ComponentType<{
    routing?: string;
    path?: string;
    signInUrl?: string;
  }>;

  export const UserButton: React.ComponentType<Record<string, unknown>>;
}

declare module "@clerk/express" {
  import type { Request, RequestHandler } from "express";

  export function clerkMiddleware(): RequestHandler;
  export function getAuth(req: Request): { userId?: string | null };

  export const clerkClient: {
    users: {
      getUser: (userId: string) => Promise<{
        emailAddresses?: Array<{ emailAddress?: string | null }>;
        publicMetadata?: Record<string, unknown>;
      }>;
    };
  };
}
