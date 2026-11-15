import { clearNativeLibraryPath, setNativeLibraryPath } from "../env.ts";
import { embeddedRegistry } from "../registry/embedded/generated-registry.ts";
import oxfmtLibrary from "../registry/embedded/native-oxfmt-library.ts";
import parserLibrary from "../registry/embedded/native-parser-library.ts";
import { registerEmbeddedRegistry } from "../registry/embedded/extract.ts";

registerEmbeddedRegistry(embeddedRegistry);

setNativeLibraryPath(parserLibrary);
await import("oxc-parser");
setNativeLibraryPath(oxfmtLibrary);
const { format } = await import("oxfmt");
await format("warmup.ts", "");
clearNativeLibraryPath();
await import("./main.ts");
