import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import App from "./App";
import { LoadingOverlay, StatsOverlay } from "./components/OverlayViews";
import { currentView } from "./lib/overlay";

// la même appli sert aussi les fenêtres par-dessus le jeu (?view=overlay, ?view=loading)
const view = currentView();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {view === "overlay" ? <StatsOverlay /> : view === "loading" ? <LoadingOverlay /> : <App />}
  </StrictMode>,
);
