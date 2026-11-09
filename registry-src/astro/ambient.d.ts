declare module "astro/config" {
  export function defineConfig(config: {
    integrations?: unknown[];
    vite?: { plugins?: unknown[]; resolve?: { alias?: unknown[] } };
  }): unknown;
}

declare module "@astrojs/react" {
  export default function react(): unknown;
}

declare module "react" {
  export function useState<State>(initial: State): [State, (next: State) => void];
}
