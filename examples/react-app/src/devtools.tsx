import { MobxDevtools } from "@mobx-devtools/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobxDevtools mode="remote" initialIsOpen />
  </StrictMode>,
);
