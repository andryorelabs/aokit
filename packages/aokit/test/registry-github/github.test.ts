import { expect, test } from "bun:test";
import { resolveGithubPin } from "../../src/registry/github.ts";
import { RegistryError, type RegistrySource } from "../../src/registry/index.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";
const otherSha = "fedcba9876543210fedcba9876543210fedcba98";

type GithubSource = Extract<RegistrySource, { kind: "github" }>;

function githubSource(ref: string): GithubSource {
  return { kind: "github", owner: "acme", repo: "mods", ref };
}

function recordingLsRemote(output: string) {
  const calls: { repositoryUrl: string; ref: string }[] = [];
  return {
    calls,
    lsRemote: (repositoryUrl: string, ref: string) => {
      calls.push({ repositoryUrl, ref });
      return Promise.resolve(output);
    },
  };
}

async function captureError(action: () => Promise<unknown>): Promise<RegistryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a RegistryError");
}

test("a ref that already is a sha40 is pinned as is, without calling git ls-remote", async () => {
  const adapter = recordingLsRemote("");
  const pin = await resolveGithubPin(githubSource(sha), adapter);
  expect(pin).toEqual({ owner: "acme", repo: "mods", sha });
  expect(adapter.calls).toEqual([]);
});

test("an uppercase sha40 ref is pinned in lowercase, without calling git ls-remote", async () => {
  const adapter = recordingLsRemote("");
  const pin = await resolveGithubPin(githubSource(sha.toUpperCase()), adapter);
  expect(pin.sha).toBe(sha);
  expect(adapter.calls).toEqual([]);
});

test("a branch ref is resolved to its full commit SHA with git ls-remote", async () => {
  const adapter = recordingLsRemote(
    `${otherSha}\trefs/heads/feature/main\n${sha}\trefs/heads/main\n`,
  );
  const pin = await resolveGithubPin(githubSource("main"), adapter);
  expect(pin).toEqual({ owner: "acme", repo: "mods", sha });
  expect(adapter.calls).toEqual([
    { repositoryUrl: "https://github.com/acme/mods.git", ref: "main" },
  ]);
});

test("an annotated tag resolves to the commit it points at, not the tag object", async () => {
  const adapter = recordingLsRemote(`${otherSha}\trefs/tags/v2\n${sha}\trefs/tags/v2^{}\n`);
  expect((await resolveGithubPin(githubSource("v2"), adapter)).sha).toBe(sha);
});

test("a tag wins over a branch of the same name, as git resolves it", async () => {
  const adapter = recordingLsRemote(`${otherSha}\trefs/heads/v2\n${sha}\trefs/tags/v2\n`);
  expect((await resolveGithubPin(githubSource("v2"), adapter)).sha).toBe(sha);
});

test("a ref the repository does not have fails with REGISTRY_NOT_FOUND naming the source", async () => {
  const adapter = recordingLsRemote(`${otherSha}\trefs/heads/feature/main\n`);
  const error = await captureError(() => resolveGithubPin(githubSource("main"), adapter));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
  expect(error.data.registry).toBe("github:acme/mods#main");
  expect(error.message).toContain("main");
});

test("a failing git ls-remote is REGISTRY_FETCH_FAILED", async () => {
  const error = await captureError(() =>
    resolveGithubPin(githubSource("main"), {
      lsRemote: () => Promise.reject(new Error("could not resolve host")),
    }),
  );
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(error.data.registry).toBe("github:acme/mods#main");
  expect(error.message).toContain("could not resolve host");
});

test("a ref that looks like a git option is refused before git runs", async () => {
  const adapter = recordingLsRemote("");
  const error = await captureError(() =>
    resolveGithubPin(githubSource("--upload-pack=touch"), adapter),
  );
  expect(error.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
  expect(adapter.calls).toEqual([]);
});
