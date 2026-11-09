import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEditBatch } from "../../src/edit/batch.ts";
import { editDefineConfig } from "../../src/edit/config.ts";
import { EditError } from "../../src/edit/errors.ts";
import { languageOf, locateAnchor, parseSource } from "../../src/edit/locate.ts";

const fixtureDirectory = join(import.meta.dir, "fixtures");
const moduleOrder = ["base", "auth", "db"];

function readFixture(fixtureName: string): string {
  return readFileSync(join(fixtureDirectory, fixtureName), "utf8");
}

function captureEditError(action: () => unknown): EditError {
  try {
    action();
  } catch (error) {
    if (error instanceof EditError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected an EditError");
}

test("untouched source stays byte-identical outside the edited span", () => {
  const source = readFixture("providers.fixture");
  const parsed = parseSource("providers.fixture", source);
  const providers = locateAnchor(parsed, "providers");
  const lastEntry = providers.value!.entries.at(-1)!;
  const batch = createEditBatch({ fileName: "providers.fixture", source, moduleOrder });
  batch.insert("auth", lastEntry.end + 1, "\n  extraProvider(),");
  const result = batch.apply();
  expect(result.slice(0, lastEntry.end + 1)).toBe(source.slice(0, lastEntry.end + 1));
  expect(result.slice(lastEntry.end + 1 + "\n  extraProvider(),".length)).toBe(
    source.slice(lastEntry.end + 1),
  );
  expect(result).toContain("// keep this list sorted by hand");
  expect(result).toContain("// auth first");
});

test("an empty batch returns the source unchanged", () => {
  const source = readFixture("providers.fixture");
  expect(createEditBatch({ fileName: "providers.fixture", source, moduleOrder }).apply()).toBe(
    source,
  );
});

test("overlapping edits fail naming both Modules", () => {
  const source = "0123456789";
  const batch = createEditBatch({ fileName: "a.ts", source, moduleOrder });
  batch.replace("auth", 2, 6, "x");
  batch.replace("db", 5, 8, "y");
  const error = captureEditError(() => batch.apply());
  expect(error.code).toBe("edit.overlap");
  expect(error.modules).toEqual(["auth", "db"]);
  expect(error.message).toContain('"auth"');
  expect(error.message).toContain('"db"');
});

test("an insert inside a replaced range overlaps; one on the boundary does not", () => {
  const source = "0123456789";
  const inside = createEditBatch({ fileName: "a.ts", source, moduleOrder });
  inside.replace("auth", 2, 6, "x");
  inside.insert("db", 4, "y");
  expect(captureEditError(() => inside.apply()).modules).toEqual(["auth", "db"]);

  const boundary = createEditBatch({ fileName: "a.ts", source, moduleOrder });
  boundary.replace("auth", 2, 6, "x");
  boundary.insert("db", 6, "y");
  boundary.insert("base", 2, "z");
  expect(boundary.apply()).toBe("01zxy6789");
});

test("same-offset inserts follow canonical Module order, not call order", () => {
  const source = "ab";
  const batch = createEditBatch({ fileName: "a.ts", source, moduleOrder });
  batch.insert("db", 1, "[db]");
  batch.insert("base", 1, "[base]");
  batch.insert("auth", 1, "[auth]");
  expect(batch.apply()).toBe("a[base][auth][db]b");
});

test("an edit from a Module outside the canonical order is rejected", () => {
  const batch = createEditBatch({ fileName: "a.ts", source: "ab", moduleOrder });
  expect(captureEditError(() => batch.insert("ghost", 1, "x")).code).toBe("edit.unknown-module");
});

test("an out-of-range edit is rejected", () => {
  const batch = createEditBatch({ fileName: "a.ts", source: "ab", moduleOrder });
  expect(captureEditError(() => batch.replace("auth", 1, 9, "x")).code).toBe("edit.out-of-range");
});

test("a missing anchor fails naming the anchor and the file", () => {
  const parsed = parseSource("src/providers.fixture", readFixture("providers.fixture"));
  const error = captureEditError(() => locateAnchor(parsed, "plugins"));
  expect(error.code).toBe("edit.anchor-not-found");
  expect(error.message).toContain('"plugins"');
  expect(error.message).toContain("src/providers.fixture");
});

test("anchors are top-level declaration names with their value spans", () => {
  const source = readFixture("providers.fixture");
  const parsed = parseSource("providers.fixture", source);
  const providers = locateAnchor(parsed, "providers");
  expect(providers.value?.kind).toBe("array");
  expect(providers.value?.entries).toHaveLength(2);
  expect(source.slice(providers.value!.start, providers.value!.start + 1)).toBe("[");
  const settings = locateAnchor(parsed, "settings");
  expect(settings.value?.kind).toBe("object");
  expect(settings.value?.entries).toHaveLength(2);
  expect(source.slice(settings.value!.start, settings.value!.end).startsWith("{")).toBe(true);
  for (const name of ["authProvider", "dbProvider", "Registry", "Mode", "answer"]) {
    expect(locateAnchor(parsed, name).name).toBe(name);
  }
  expect(parsed.imports.map((located) => located.source)).toEqual(["./app", "./types"]);
});

test("as/satisfies wrappers are unwrapped to the literal", () => {
  const parsed = parseSource("unicode.fixture", readFixture("unicode.fixture"));
  expect(locateAnchor(parsed, "flags").value?.kind).toBe("object");
});

test("an unparsable file fails with the file name", () => {
  const error = captureEditError(() => parseSource("broken.ts", "export const = ;"));
  expect(error.code).toBe("edit.parse-failed");
  expect(error.message).toContain("broken.ts");
});

test("editDefineConfig edits export default defineConfig({...}) and keeps the rest", () => {
  const source = readFixture("vite.config.fixture");
  const result = editDefineConfig("vite.config.fixture", source, (config) => {
    config["base"] = "/app/";
  });
  expect(result).toContain('base: "/app/"');
  expect(result).toContain("// project config");
  expect(result).toContain("server: {");
});

test("editDefineConfig rejects files that are not defineConfig exports", () => {
  const error = captureEditError(() =>
    editDefineConfig("x.config.ts", "export default { a: 1 };\n", () => undefined),
  );
  expect(error.code).toBe("edit.config-shape");
  expect(error.message).toContain("x.config.ts");
});

test("parses JSX in a tsx file and picks the language from the extension", () => {
  expect(languageOf("src/providers.tsx")).toBe("tsx");
  expect(languageOf("src/config.ts")).toBe("ts");
  const parsed = parseSource(
    "src/providers.tsx",
    "export const providers = [];\nexport const view = <div>{providers.length}</div>;\n",
  );
  expect(parsed.anchors.map((anchor) => anchor.name)).toContain("providers");
});
