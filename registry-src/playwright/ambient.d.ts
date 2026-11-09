declare module "@playwright/test" {
  interface Locator {
    click(): Promise<void>;
  }
  interface Page {
    goto(url: string): Promise<unknown>;
    locator(selector: string): Locator;
  }
  interface Expectation {
    toBeVisible(): Promise<void>;
    toEqual(expected: unknown): Promise<void>;
  }
  export function test(name: string, run: (fixtures: { page: Page }) => void | Promise<void>): void;
  export function expect(value: unknown): Expectation;
  export function defineConfig(config: object): object;
  export const devices: Record<string, object>;
}
