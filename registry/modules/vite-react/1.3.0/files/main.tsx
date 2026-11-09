import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { providers } from "./providers";
import { routes } from "./router";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element in index.html");
}

const route = routes.find((candidate) => candidate.path === window.location.pathname);
const page = providers.reduceRight(
  (children, Provider) => createElement(Provider, null, children),
  route?.element,
);

createRoot(root).render(createElement(StrictMode, null, page));
