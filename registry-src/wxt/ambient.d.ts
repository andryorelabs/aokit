declare module "wxt" {
  export function defineConfig(config: {
    modules?: string[];
    manifest?: Record<string, unknown>;
  }): unknown;
}

declare module "wxt/utils/define-background" {
  export function defineBackground(main: () => void): unknown;
}

declare module "wxt/browser" {
  export const browser: { runtime: { id: string } };
}

declare module "react" {
  export function useState<State>(initial: State): [State, (next: State) => void];
}
