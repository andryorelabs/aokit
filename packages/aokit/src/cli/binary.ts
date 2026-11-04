import { embeddedRegistry } from "../registry/embedded/generated-registry.ts";
import oxfmtLibrary from "../registry/embedded/native-oxfmt-library.ts";
import parserLibrary from "../registry/embedded/native-parser-library.ts";
import { registerEmbeddedRegistry } from "../registry/embedded/extract.ts";

registerEmbeddedRegistry(embeddedRegistry);

process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = parserLibrary;
await import("oxc-parser");
process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = oxfmtLibrary;
const { format } = await import("oxfmt");
await format("warmup.ts", "");
delete process.env["NAPI_RS_NATIVE_LIBRARY_PATH"];
await import("./main.ts");
