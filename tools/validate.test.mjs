import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePublication } from "./validate.mjs";

const publicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createPublication(context, markdown) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodejs-publication-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "resources"), { recursive: true });
  await mkdir(path.join(root, "profiles"));
  await mkdir(path.join(root, "contributions"));
  await writeFile(
    path.join(root, "resources", "navigation.yaml"),
    "groups:\n  - title: 시작\n    items:\n      - guide\n",
  );
  await writeFile(path.join(root, "resources", "guide.md"), markdown);
  return root;
}

async function writeContributionImage(root, name) {
  const imageRoot = path.join(root, "contributions", "resources");
  await mkdir(imageRoot, { recursive: true });
  await writeFile(path.join(imageRoot, name), "PNG fixture");
}

test("validates the repository content", async () => {
  await validatePublication(publicationRoot);
});

test("allows a navigation title override", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "resources", "navigation.yaml"),
    "groups:\n  - title: 시작\n    items:\n      - file: ./guide.md\n        title: Guide shortcut\n",
  );

  await validatePublication(root);
});

test("rejects a relative file link", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n\n[slides](./slides.pdf)\n",
  );

  await assert.rejects(validatePublication(root), /상대 파일 링크/);
});

test("allows a query-relative link to an existing resource", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n\n[guide](?view=resources&resource=guide)\n",
  );

  await validatePublication(root);
});

test("rejects a query-relative link to a missing resource", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n\n[missing](?view=resources&resource=missing)\n",
  );

  await assert.rejects(validatePublication(root), /내부 resource를 찾을 수 없습니다: missing/);
});

test("requires at least one canonical author for a resource", async (context) => {
  const root = await createPublication(context, "# Guide\n\nShort description.\n");

  await assert.rejects(validatePublication(root), /authors/);
});

test("validates contribution notes by Pull Request number", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Problem\n\nWhat I learned.\n",
  );

  await validatePublication(root);
});

test("allows supported local images in a contribution note", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  const images = [
    "12345-debugger.png",
    "12345-photo.jpg",
    "12345-screenshot.jpeg",
    "12345-output.webp",
    "12345-animation.gif",
  ];
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    `---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Verification\n\n${images.map((image) => `![image](./resources/${image})`).join("\n\n")}\n`,
  );
  await Promise.all(images.map((image) => writeContributionImage(root, image)));

  await validatePublication(root);
});

test("rejects an unsupported contribution image type", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Verification\n\n![diagram](./resources/12345-diagram.svg)\n",
  );
  await writeContributionImage(root, "12345-diagram.svg");

  await assert.rejects(validatePublication(root), /PNG, JPEG, WebP 또는 GIF/);
});

test("rejects a root-relative contribution image", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Verification\n\n![debugger](/contributions/resources/12345-debugger.png)\n",
  );
  await writeContributionImage(root, "12345-debugger.png");

  await assert.rejects(validatePublication(root), /\.\/resources\/<PR번호>/);
});

test("rejects an image for another Pull Request", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Verification\n\n![debugger](./resources/54321-debugger.png)\n",
  );
  await writeContributionImage(root, "54321-debugger.png");

  await assert.rejects(validatePublication(root), /Pull Request 번호가 일치하지 않습니다/);
});

test("rejects a missing contribution image", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\n---\n## Verification\n\n![debugger](./resources/12345_debugger.png)\n",
  );

  await assert.rejects(validatePublication(root), /이미지 파일을 찾을 수 없습니다/);
});

test("allows an optional source URL for a contribution note", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\nurl: https://example.com/contribution\n---\n## Problem\n\nWhat I learned.\n",
  );

  await validatePublication(root);
});

test("rejects an unsafe source URL for a contribution note", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "---\npr-url: https://github.com/nodejs/node/pull/12345\nurl: javascript:alert(1)\n---\n## Problem\n\nWhat I learned.\n",
  );

  await assert.rejects(validatePublication(root), /url은 http 또는 https/);
});

test("requires pr-url metadata for a contribution note", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "12345.md"),
    "## Problem\n\nWhat I learned.\n",
  );

  await assert.rejects(validatePublication(root), /pr-url frontmatter가 필요합니다/);
});

test("rejects a contribution note without a Pull Request number", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "contributions", "stream-fix.md"),
    "---\nauthors: [github-id]\n---\n# Contribution note\n",
  );

  await assert.rejects(validatePublication(root), /PR 번호/);
});

test("rejects nested resource directories", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await mkdir(path.join(root, "resources", "nested"));

  await assert.rejects(validatePublication(root), /flat Markdown/);
});

test("rejects unsafe link schemes", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n\n[unsafe](javascript:alert(1))\n",
  );

  await assert.rejects(validatePublication(root), /scheme/);
});

test("warns when a resource is not listed in navigation", async (context) => {
  const root = await createPublication(
    context,
    "---\nauthors: [github-id]\n---\n# Guide\n\nShort description.\n",
  );
  await writeFile(
    path.join(root, "resources", "hidden-guide.md"),
    "---\nauthors: [github-id]\n---\n# Hidden guide\n\nShort description.\n",
  );
  const warn = context.mock.method(console, "warn", () => {});

  await validatePublication(root);

  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /navigation에 없는 resource.*hidden-guide/);
});
