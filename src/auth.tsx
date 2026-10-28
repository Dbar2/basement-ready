// Accounts are optional: without VITE_CLERK_PUBLISHABLE_KEY the app runs signed-out only.
import { ClerkProvider, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
export const accountsEnabled = Boolean(CLERK_KEY);

const CLAIMS = "br-claims";

// After sign-in, moves scans made on this browser into the account.
function ClaimOnSignIn() {
  const { isSignedIn, getToken } = useAuth();
  useEffect(() => {
    if (!isSignedIn) return;
    let claims: unknown[] = [];
    try {
      claims = JSON.parse(localStorage.getItem(CLAIMS) ?? "[]");
    } catch {
      return;
    }
    if (!claims.length) return;
    void (async () => {
      const res = await fetch("/api/me/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({ claims }),
      });
      if (res.ok) localStorage.removeItem(CLAIMS);
    })();
  }, [isSignedIn, getToken]);
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!CLERK_KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/">
      <ClaimOnSignIn />
      {children}
    </ClerkProvider>
  );
}

function AccountNavInner() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? (
    <span className="account-nav">
      <Link to="/dashboard">My basements</Link>
      <UserButton />
    </span>
  ) : (
    <SignInButton mode="modal">
      <button className="link-quiet">Sign in</button>
    </SignInButton>
  );
}

export function AccountNav() {
  return accountsEnabled ? <AccountNavInner /> : null;
}

function SaveCtaInner() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) {
    return (
      <p className="save-cta saved">
        Saved to <Link to="/dashboard">My basements</Link>.
      </p>
    );
  }
  return (
    <div className="save-cta">
      <p>Save this basement to answer the open questions, keep your plan and send it to a designer.</p>
      <SignUpButton mode="modal">
        <button className="btn btn-primary">Save my basement <span className="arrow" aria-hidden>→</span></button>
      </SignUpButton>
    </div>
  );
}

export function SaveCta() {
  return accountsEnabled ? <SaveCtaInner /> : null;
}

// fetch() for signed-in API calls.
export function useApi() {
  const { getToken } = useAuth();
  return async (path: string, init: RequestInit = {}) => {
    const token = await getToken();
    return fetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  };
}
