declare module "vitest" {
  export function test(name: string, run: () => void | Promise<void>): void;
  export function expect(value: unknown): { toBe(expected: unknown): void };
}

declare module "vitest/config" {
  export function defineConfig(config: {
    test?: { include?: string[]; environment?: string };
  }): object;
}
