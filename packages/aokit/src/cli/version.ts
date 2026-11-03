import packageManifest from "../../package.json" with { type: "json" };

export const cliVersion: string = packageManifest.version;
