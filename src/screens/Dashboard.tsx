// My basements: everything a signed-in homeowner has scanned, plus deleting their data.
import { SignInButton, useAuth, useClerk } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountNav, accountsEnabled, useApi } from "../auth";
import { Logo } from "../components/Logo";

type Item = {
  id: string;
  address: string;
  municipality: string;
  updatedAt: string;
  latestScan: { id: string; status: string; headline: string | null; verdict: string | null; cost: { low: number; high: number } | null; createdAt: string } | null;
};

const CITY: Record<string, string> = { "waterloo-on": "Waterloo", "kitchener-on": "Kitchener", "cambridge-on": "Cambridge" };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

function DashboardInner() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signOut } = useClerk();
  const api = useApi();
  const [items, setItems] = useState<Item[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    void api("/api/me/basements").then(async (r) => setItems(r.ok ? (await r.json()).basements : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <section className="block">
        <h1 className="dash-title">My basements</h1>
        <p className="lede">Sign in to see the basements you've saved.</p>
        <SignInButton mode="modal"><button className="btn btn-primary">Sign in</button></SignInButton>
      </section>
    );
  }

  const remove = async (id: string) => {
    if (!window.confirm("Delete this basement, its scans and video? This can't be undone.")) return;
    const r = await api(`/api/me/basements/${id}`, { method: "DELETE" });
    if (r.ok) setItems((prev) => prev?.filter((b) => b.id !== id) ?? null);
  };

  const deleteAll = async () => {
    const r = await api("/api/me", { method: "DELETE" });
    if (r.ok) await signOut({ redirectUrl: "/" });
  };

  return (
    <>
      <section className="block">
        <h1 className="dash-title">My basements</h1>
        {items === null && <p className="muted">Loading…</p>}
        {items?.length === 0 && (
          <p className="lede">
            Nothing saved yet. <Link to="/">Scan a basement</Link> and it will appear here.
          </p>
        )}
        {items && items.length > 0 && (
          <ul className="ruled dash-list">
            {items.map((b) => (
              <li key={b.id}>
                <div>
                  <h3>{b.address || `Basement in ${CITY[b.municipality] ?? "Ontario"}`}</h3>
                  <p className="muted">
                    {CITY[b.municipality] ?? "Ontario"} · scanned {new Date(b.latestScan?.createdAt ?? b.updatedAt).toLocaleDateString("en-CA")}
                  </p>
                </div>
                <div className="dash-verdict">
                  {b.latestScan?.headline ?? (b.latestScan?.status === "error" ? "Scan failed" : "Scanning…")}
                  {b.latestScan?.cost && b.latestScan.cost.high > 0 && (
                    <span className="mono"> {money(b.latestScan.cost.low)}–{money(b.latestScan.cost.high)}</span>
                  )}
                </div>
                <div className="dash-actions">
                  {b.latestScan && (
                    <Link className="btn btn-ghost" to="/scans/$scanId" params={{ scanId: b.latestScan.id }}>Open</Link>
                  )}
                  <button className="link-quiet" onClick={() => remove(b.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block danger">
        <h2>Your data</h2>
        <p className="lede">
          Deleting removes every basement, scan, video and answer we hold for you. Raw videos are deleted after 30 days
          even if you do nothing.
        </p>
        {confirming ? (
          <div className="actions">
            <button className="btn btn-stop" onClick={deleteAll}>Yes, delete everything</button>
            <button className="link-quiet" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirming(true)}>Delete my data</button>
        )}
      </section>
    </>
  );
}

export function Dashboard() {
  return (
    <main className="result">
      <header className="nav">
        <Logo />
        <AccountNav />
      </header>
      {accountsEnabled ? (
        <DashboardInner />
      ) : (
        <section className="block">
          <h1 className="dash-title">My basements</h1>
          <p className="lede">Accounts are coming soon. For now, bookmark your scan's page to come back to it.</p>
        </section>
      )}
    </main>
  );
}
