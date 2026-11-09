declare module "@axe-core/playwright" {
  export default class AxeBuilder {
    constructor(options: { page: object });
    analyze(): Promise<{ violations: unknown[] }>;
  }
}
