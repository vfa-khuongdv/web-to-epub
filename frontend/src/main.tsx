import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LangProvider } from "./i18n";
import { VaultProvider, useVault } from "./vault";
import "./styles.css";

// Switching libraries remounts the whole app: every list, selection, open chapter and
// live channel is rebuilt against the library now in force, and nothing from the
// private one is left in memory once it is locked.
function Workspace() {
  const { active } = useVault();
  return <App key={active ? "private" : "public"} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LangProvider>
      <VaultProvider>
        <Workspace />
      </VaultProvider>
    </LangProvider>
  </React.StrictMode>
);
