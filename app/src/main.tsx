import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import App from "./App";
import { LoadingOverlay, StatsOverlay } from "./components/OverlayViews";
import { BubbleWindow, BuildWindow, CompactWindow } from "./components/SideWindows";
import { currentView } from "./lib/overlay";
import { installJournal } from "./lib/journal";

installJournal();

// la même appli sert aussi les fenêtres d'appoint : overlays du jeu, mode compact, bulle, menu de build
const view = currentView();
const screens = { overlay: StatsOverlay, loading: LoadingOverlay, compact: CompactWindow, bubble: BubbleWindow, build: BuildWindow };
const Screen = view === "app" ? App : screens[view];
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Screen />
  </StrictMode>,
);
