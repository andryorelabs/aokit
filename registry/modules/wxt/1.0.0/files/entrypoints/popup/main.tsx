import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element in popup index.html");
}

createRoot(root).render(createElement(StrictMode, null, createElement(App, null)));
