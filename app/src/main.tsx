import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initTelegram } from "./tg";
import "./styles.css";

initTelegram();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary onReset={() => window.location.reload()}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
