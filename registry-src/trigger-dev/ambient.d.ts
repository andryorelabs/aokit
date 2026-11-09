declare module "@trigger.dev/sdk" {
  export function defineConfig(config: {
    project: string;
    dirs: string[];
    maxDuration: number;
  }): object;
  export function task(definition: {
    id: string;
    run: (payload: { name: string }) => Promise<object>;
  }): object;
}
