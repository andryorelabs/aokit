import { expect, test } from "bun:test";
import { EditError } from "../../src/edit/errors.ts";
import { createEditSession } from "../../src/edit/session.ts";

function sessionOver(files: Record<string, string>) {
  const written: string[] = [];
  const edited: string[] = [];
  const session = createEditSession({
    moduleOrder: ["base", "auth", "db"],
    read: (path) => files[path],
    write: (path, content) => {
      files[path] = content;
      written.push(path);
    },
    onEdit: (path, module) => edited.push(`${path}:${module}`),
  });
  return { session, files, written, edited };
}

test("edits of several Modules to one file form one batch applied on flush", () => {
  const { session, files, written, edited } = sessionOver({ "a.ts": "abc" });
  session.batchFor("a.ts", "db").insert("db", 1, "D");
  session.batchFor("a.ts", "auth").insert("auth", 1, "A");
  expect(files["a.ts"]).toBe("abc");
  session.flush();
  expect(files["a.ts"]).toBe("aADbc");
  expect(written).toEqual(["a.ts"]);
  expect(edited).toEqual(["a.ts:db", "a.ts:auth"]);
});

test("flushing one path leaves other open batches queued", () => {
  const { session, files } = sessionOver({ "a.ts": "a", "b.ts": "b" });
  session.batchFor("a.ts", "auth").insert("auth", 1, "1");
  session.batchFor("b.ts", "auth").insert("auth", 1, "2");
  session.flush("a.ts");
  expect(files).toEqual({ "a.ts": "a1", "b.ts": "b" });
  session.flush();
  expect(files["b.ts"]).toBe("b2");
});

test("a batch opened after a flush starts from the written content", () => {
  const { session, files } = sessionOver({ "a.ts": "a" });
  session.batchFor("a.ts", "auth").insert("auth", 1, "1");
  session.flush("a.ts");
  session.batchFor("a.ts", "db").insert("db", 2, "2");
  session.flush();
  expect(files["a.ts"]).toBe("a12");
});

test("an empty batch writes nothing", () => {
  const { session, written } = sessionOver({ "a.ts": "a" });
  session.batchFor("a.ts", "auth");
  session.flush();
  expect(written).toEqual([]);
});

test("overlapping edits of two Modules fail with edit.overlap naming both", () => {
  const { session } = sessionOver({ "a.ts": "abcdef" });
  session.batchFor("a.ts", "auth").replace("auth", 1, 4, "X");
  session.batchFor("a.ts", "db").replace("db", 3, 5, "Y");
  let caught: unknown;
  try {
    session.flush("a.ts");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EditError);
  expect(caught instanceof EditError && caught.code).toBe("edit.overlap");
  expect(caught instanceof EditError && caught.modules).toEqual(["auth", "db"]);
});

test("a file without text content cannot be batched", () => {
  const { session } = sessionOver({});
  expect(() => session.batchFor("missing.ts", "auth")).toThrow(EditError);
});
