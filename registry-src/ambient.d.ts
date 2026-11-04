/**
 * Minimal ambient declarations for the packages and globals the Registry source files import.
 * The files render into user Projects that install the real packages; the workspace only needs
 * enough surface to typecheck the sources.
 */

declare const document: { getElementById(id: string): object | null };

declare const window: { location: { pathname: string } };

interface ImportMeta {
  glob(pattern: string, options?: { eager?: boolean }): Record<string, unknown>;
}

declare module "react" {
  export type ReactNode = string | number | boolean | null | undefined | object;
  export type PropsWithChildren<Props = unknown> = Props & { children?: ReactNode };
  export type ComponentType<Props = unknown> = (props: Props) => ReactNode;
  export const StrictMode: ComponentType<PropsWithChildren>;
}

declare module "react/jsx-runtime" {
  export namespace JSX {
    type Element = string | number | boolean | null | undefined | object;
    interface ElementChildrenAttribute {
      children: unknown;
    }
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
  }
  export function jsx(type: unknown, props: unknown, key?: string): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: string): JSX.Element;
}

declare module "react-dom/client" {
  export function createRoot(container: object): { render(node: unknown): void };
}

declare module "vite" {
  export interface PluginOption {
    name?: string;
  }
  export function defineConfig(config: { plugins: PluginOption[] }): { plugins: PluginOption[] };
}

declare module "@vitejs/plugin-react" {
  export default function react(): { name?: string };
}

declare module "hono" {
  export interface Context {
    json(body: unknown): Response;
  }
  export type MiddlewareHandler = (context: Context, next: () => Promise<void>) => Promise<void>;
  export class Hono {
    use(handler: MiddlewareHandler): this;
    route(path: string, app: Hono): this;
    get(path: string, handler: (context: Context) => Response): this;
  }
}
