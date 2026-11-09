declare module "vitest" {
  export function beforeAll(run: () => void | Promise<void>): void;
  export function afterEach(run: () => void | Promise<void>): void;
  export function afterAll(run: () => void | Promise<void>): void;
}

declare module "msw" {
  export interface RequestHandler {
    readonly kind: string;
  }
  export const http: {
    get(path: string, resolver: () => unknown): RequestHandler;
  };
  export const HttpResponse: {
    json(body: unknown): unknown;
  };
}

declare module "msw/node" {
  import type { RequestHandler } from "msw";
  export function setupServer(...handlers: RequestHandler[]): {
    listen(options?: { onUnhandledRequest?: "error" | "warn" | "bypass" }): void;
    resetHandlers(): void;
    close(): void;
  };
}
