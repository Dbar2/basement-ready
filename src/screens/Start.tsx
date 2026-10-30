import { useState } from "react";
import { Home } from "../marketing/Home";
import { StartSheet } from "./StartSheet";

export function Start() {
  const [asking, setAsking] = useState(false);
  return (
    <main className="home">
      <Home onCheck={() => setAsking(true)} />

      {/* The start sheet: the address or the demo house, who it's for, then film or upload. */}
      {asking && <StartSheet onClose={() => setAsking(false)} />}
    </main>
  );
}
