import "@fontsource-variable/schibsted-grotesk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SalesPage } from "../features/sales/SalesPage";
import { applyGlobalStyles } from "./globalStyles";

applyGlobalStyles();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SalesPage />
  </StrictMode>,
);
