import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "katex/dist/katex.min.css";
import "./index.css";

// "ResizeObserver loop completed with undelivered notifications" is a harmless browser notice: the
// tree view (React Flow) resizes while the panel resizes, so one size change is delivered a frame
// later. Chrome listed it as an extension error on reload (seen live). Only this exact notice is
// silenced; every other error is reported as before.
window.addEventListener("error", (e) => {
  if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(e.message || "")) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

