import { createContext } from "react";

/** The web viewer's Models and Files browser, docked above the active file's inspector. */
export const ExplorerPaneContext = createContext(/** @type {import("react").ReactNode} */ (null));

/** Where an alternate document view can replace the canvas while the sidebar stays mounted. */
export const AlternateViewportContext = createContext(/** @type {{
  active: boolean, attach: (element: HTMLDivElement | null) => void
} | null} */ (null));
