import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PR_NUMBER = /^[1-9]\d*$/;
const CONTRIBUTION_IMAGE = /^([1-9]\d*)[-_]([A-Za-z0-9][A-Za-z0-9_-]*)\.(png|jpe?g|webp|gif)$/;
const CONTRIBUTION_IMAGE_TARGET = /^\.\/resources\/(([1-9]\d*)[-_][A-Za-z0-9][A-Za-z0-9_-]*\.(?:png|jpe?g|webp|gif))$/;
const INTERNAL_RESOURCE_LINK = /^\?view=resources&resource=([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const UNSAFE_MARKUP = /<(?:embed|iframe|link|object|script|style)\b|\son[a-z]+\s*=/i;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function markdownBody(source, file, resource, headingRequired = true) {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  let markdown = normalized;
  if (normalized.startsWith("---\n")) {
    const closingFence = normalized.indexOf("\n---\n", 4);
    requireValue(closingFence !== -1, `${file}: frontmatter 종료 구분자가 없습니다.`);
    markdown = normalized.slice(closingFence + 5).trim();
  }

  requireValue(!UNSAFE_MARKUP.test(markdown), `${file}: unsafe HTML을 포함할 수 없습니다.`);
  const [heading = "", ...remainingLines] = markdown.split("\n");
  if (headingRequired) {
    requireValue(/^#\s+\S/.test(heading.trim()), `${file}: 첫 요소는 제목이어야 합니다.`);
  }
  if (resource) {
    const rest = remainingLines.join("\n").trim();
    const paragraphEnd = rest.search(/\n\s*\n/);
    const paragraph = (paragraphEnd === -1 ? rest : rest.slice(0, paragraphEnd)).trim();
    requireValue(
      paragraph && !/^(?:#|[-*+]\s|\d+\.\s|>)/.test(paragraph),
      `${file}: 제목 다음에 짧은 설명이 필요합니다.`,
    );
  }
  return markdown;
}

function validateResourceMetadata(source, file) {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  requireValue(normalized.startsWith("---\n"), `${file}: authors frontmatter가 필요합니다.`);
  const closingFence = normalized.indexOf("\n---\n", 4);
  requireValue(closingFence !== -1, `${file}: frontmatter 종료 구분자가 없습니다.`);
  const frontmatter = normalized.slice(4, closingFence);
  const authorsMatch = /^authors:\s*\[([^\]]*)\]\s*$/m.exec(frontmatter);
  requireValue(authorsMatch, `${file}: authors 배열이 필요합니다.`);
  const authors = authorsMatch[1]
    .split(",")
    .map((author) => author.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  requireValue(authors.length > 0, `${file}: authors는 한 명 이상이어야 합니다.`);
  for (const author of authors) {
    requireValue(SLUG.test(author), `${file}: canonical author ID가 올바르지 않습니다: ${author}`);
  }

  const urlMatch = /^url:\s*(.+)\s*$/m.exec(frontmatter);
  if (urlMatch) {
    const url = urlMatch[1].trim().replace(/^["']|["']$/g, "");
    requireValue(/^https?:\/\//i.test(url), `${file}: url은 http 또는 https여야 합니다.`);
  }
}

async function validateContribution(publicationRoot, entry, images) {
  const label = `contributions/${entry.name}`;
  requireValue(
    entry.isFile() && entry.name.endsWith(".md"),
    `${label}: Markdown 파일이어야 합니다.`,
  );
  const number = entry.name.slice(0, -3);
  requireValue(PR_NUMBER.test(number), `${label}: nodejs/node PR 번호가 올바르지 않습니다.`);
  const contributionPath = path.join(publicationRoot, label);
  await validateFile(contributionPath, label);
  const source = await readFile(contributionPath, "utf8");
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  requireValue(normalized.startsWith("---\n"), `${label}: pr-url frontmatter가 필요합니다.`);
  const closingFence = normalized.indexOf("\n---\n", 4);
  requireValue(closingFence !== -1, `${label}: frontmatter 종료 구분자가 없습니다.`);
  const frontmatter = normalized.slice(4, closingFence);
  const metadataLines = frontmatter
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const prUrlLines = metadataLines.filter((line) => line.startsWith("pr-url:"));
  const urlLines = metadataLines.filter((line) => line.startsWith("url:"));
  requireValue(
    prUrlLines.length === 1
      && urlLines.length <= 1
      && metadataLines.length === prUrlLines.length + urlLines.length,
    `${label}: frontmatter에는 pr-url과 선택적 url만 사용할 수 있습니다.`,
  );
  const prUrlMatch = /^pr-url:\s*(.+)\s*$/m.exec(frontmatter);
  requireValue(prUrlMatch, `${label}: pr-url이 필요합니다.`);
  const prUrl = prUrlMatch[1].trim().replace(/^["']|["']$/g, "");
  requireValue(
    prUrl === `https://github.com/nodejs/node/pull/${number}`,
    `${label}: pr-url이 파일의 Pull Request 번호와 일치하지 않습니다.`,
  );
  const urlMatch = /^url:\s*(.+)\s*$/m.exec(frontmatter);
  if (urlMatch) {
    const url = urlMatch[1].trim().replace(/^["']|["']$/g, "");
    requireValue(/^https?:\/\//i.test(url), `${label}: url은 http 또는 https여야 합니다.`);
  }
  const markdown = markdownBody(source, label, false, false);
  for (const rawTarget of imageTargets(markdown)) {
    const imageTarget = CONTRIBUTION_IMAGE_TARGET.exec(rawTarget);
    requireValue(
      imageTarget,
      `${label}: 이미지는 ./resources/<PR번호>-<이름>.<확장자> 형식이어야 합니다: ${rawTarget}`,
    );
    requireValue(
      imageTarget[2] === number,
      `${label}: 이미지 파일의 Pull Request 번호가 일치하지 않습니다: ${rawTarget}`,
    );
    requireValue(
      images.has(imageTarget[1]),
      `${label}: 이미지 파일을 찾을 수 없습니다: ${rawTarget}`,
    );
  }
}

function imageTargets(markdown) {
  const targets = [];
  const image = /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(image)) targets.push(match[1] ?? match[2]);
  return targets;
}

function relativeTargets(markdown) {
  const targets = [];
  const link = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(link)) targets.push(match[1] ?? match[2]);
  const reference = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const match of markdown.matchAll(reference)) targets.push(match[1] ?? match[2]);
  return targets;
}

async function validateFile(file, label) {
  const stats = await lstat(file);
  requireValue(!stats.isSymbolicLink(), `${label}: symlink는 허용하지 않습니다.`);
  requireValue(stats.isFile(), `${label}: 일반 파일이어야 합니다.`);
  requireValue(stats.size <= MAX_FILE_SIZE, `${label}: 파일 크기는 10MB 이하여야 합니다.`);
}

async function validateContributionImages(publicationRoot, entry) {
  const root = path.join(publicationRoot, "contributions", entry.name);
  const images = new Set();
  for (const imageEntry of await readdir(root, { withFileTypes: true })) {
    const label = `contributions/resources/${imageEntry.name}`;
    requireValue(
      imageEntry.isFile() && CONTRIBUTION_IMAGE.test(imageEntry.name),
      `${label}: <PR번호>-<이름> 형식의 PNG, JPEG, WebP 또는 GIF 파일이어야 합니다.`,
    );
    const imagePath = path.join(root, imageEntry.name);
    await validateFile(imagePath, label);
    images.add(imageEntry.name);
  }
  return images;
}

async function validateResource(publicationRoot, slug, slugs) {
  const label = `resources/${slug}.md`;
  requireValue(SLUG.test(slug), `${label}: slug가 올바르지 않습니다.`);
  const resourcePath = path.join(publicationRoot, label);
  await validateFile(resourcePath, label);
  const source = await readFile(resourcePath, "utf8");
  validateResourceMetadata(source, label);
  const markdown = markdownBody(source, label, true);

  for (const rawTarget of relativeTargets(markdown)) {
    if (rawTarget.startsWith("#")) continue;
    const internalResource = INTERNAL_RESOURCE_LINK.exec(rawTarget);
    if (internalResource) {
      requireValue(
        slugs.has(internalResource[1]),
        `${label}: 내부 resource를 찾을 수 없습니다: ${internalResource[1]}`,
      );
      continue;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(rawTarget);
    if (scheme) {
      requireValue(
        /^(?:https?|mailto)$/i.test(scheme[1]),
        `resources/${slug}: unsafe link scheme은 허용하지 않습니다: ${scheme[1]}`,
      );
      continue;
    }
    throw new Error(`${label}: 상대 파일 링크는 허용하지 않습니다: ${rawTarget}`);
  }
}

function validateNavigation(value, slugs) {
  requireValue(value && Array.isArray(value.groups) && value.groups.length > 0, "resources/navigation.yaml에 groups가 필요합니다.");
  const listed = new Set();
  for (const group of value.groups) {
    requireValue(typeof group.title === "string" && group.title.trim(), "navigation group title이 필요합니다.");
    requireValue(Array.isArray(group.items) && group.items.length > 0, `${group.title}: items가 필요합니다.`);
    for (const item of group.items) {
      const file = typeof item === "string" ? item : item?.file;
      if (typeof item !== "string") {
        requireValue(
          item && typeof item === "object" && !Array.isArray(item),
          `navigation item이 올바르지 않습니다: ${String(item)}`,
        );
        requireValue(
          typeof item.title === "string" && item.title.trim(),
          `navigation title이 올바르지 않습니다: ${String(file)}`,
        );
      }
      const fileMatch = typeof file === "string"
        ? /^\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(file)
        : null;
      const slug = fileMatch?.[1] ?? (typeof file === "string" && SLUG.test(file) ? file : null);
      requireValue(slug, `navigation file이 올바르지 않습니다: ${String(file)}`);
      requireValue(slugs.has(slug), `navigation resource를 찾을 수 없습니다: ${file}`);
      requireValue(!listed.has(slug), `navigation resource가 중복되었습니다: ${file}`);
      listed.add(slug);
    }
  }
  const missing = [...slugs].filter((slug) => !listed.has(slug));
  if (missing.length > 0) {
    console.warn(`validate: warning: navigation에 없는 resource가 있습니다: ${missing.join(", ")}`);
  }
}

export async function validatePublication(publicationRoot) {
  const resourcesRoot = path.join(publicationRoot, "resources");
  const resourceEntries = await readdir(resourcesRoot, { withFileTypes: true });
  const markdownEntries = resourceEntries.filter((entry) => entry.name !== "navigation.yaml");
  for (const entry of markdownEntries) {
    requireValue(
      entry.isFile() && entry.name.endsWith(".md"),
      `resources/${entry.name}: resources에는 flat Markdown 파일만 둘 수 있습니다.`,
    );
  }
  const slugs = new Set(markdownEntries.map((entry) => entry.name.slice(0, -3)));
  await Promise.all([...slugs].map((slug) => validateResource(publicationRoot, slug, slugs)));

  const navigationPath = path.join(resourcesRoot, "navigation.yaml");
  await validateFile(navigationPath, "resources/navigation.yaml");
  validateNavigation(parse(await readFile(navigationPath, "utf8")), slugs);

  const profilesRoot = path.join(publicationRoot, "profiles");
  for (const entry of await readdir(profilesRoot, { withFileTypes: true })) {
    if (entry.name === ".gitkeep") continue;
    requireValue(entry.isFile() && entry.name.endsWith(".md"), `profiles/${entry.name}: Markdown 파일이어야 합니다.`);
    const login = entry.name.slice(0, -3);
    requireValue(SLUG.test(login), `profiles/${entry.name}: GitHub ID가 올바르지 않습니다.`);
    const profilePath = path.join(profilesRoot, entry.name);
    await validateFile(profilePath, `profiles/${entry.name}`);
    markdownBody(await readFile(profilePath, "utf8"), `profiles/${entry.name}`, false);
  }

  const contributionsRoot = path.join(publicationRoot, "contributions");
  const contributionEntries = await readdir(contributionsRoot, { withFileTypes: true });
  const imageEntry = contributionEntries.find((entry) => entry.name === "resources");
  if (imageEntry) {
    requireValue(imageEntry.isDirectory(), "contributions/resources: 디렉터리여야 합니다.");
  }
  const images = imageEntry
    ? await validateContributionImages(publicationRoot, imageEntry)
    : new Set();
  await Promise.all(
    contributionEntries
      .filter((entry) => entry !== imageEntry)
      .map((entry) => validateContribution(publicationRoot, entry, images)),
  );
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const publicationRoot = path.resolve(path.dirname(modulePath), "..");
  validatePublication(publicationRoot).catch((error) => {
    console.error(`validate: ${error.message}`);
    process.exitCode = 1;
  });
}
