#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const KNOWN_HEADINGS = new Set([
  "Breaking",
  "Added",
  "Changed",
  "Fixed",
  "Deprecated",
  "Removed",
  "Security",
]);

const MAJOR_HEADINGS = new Set(["Breaking", "Removed"]);
const MINOR_HEADINGS = new Set(["Added", "Deprecated"]);

const changelogPath = "CHANGELOG.md";
const packagePath = "package.json";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function incrementVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) {
    fail(`package.json version must be plain semver, got ${version}`);
  }

  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function extractUnreleased(changelog) {
  const start = changelog.match(/^## \[?Unreleased\]?\s*$/im);

  if (!start) {
    fail("CHANGELOG.md must contain a ## [Unreleased] section");
  }

  const afterStart = changelog.slice(start.index + start[0].length);
  const nextRelease = afterStart.search(/^##\s+/m);

  return nextRelease === -1 ? afterStart : afterStart.slice(0, nextRelease);
}

function parseUnreleased(section) {
  const entriesByHeading = new Map();
  let currentHeading = null;
  let currentLines = [];

  const flush = () => {
    if (currentHeading === null) {
      return;
    }

    const content = currentLines.join("\n").trim();

    if (content.length > 0) {
      entriesByHeading.set(currentHeading, content);
    }
  };

  for (const rawLine of section.split(/\r?\n/)) {
    const headingMatch = /^###\s+(.+?)\s*$/.exec(rawLine);

    if (headingMatch) {
      flush();
      currentLines = [];
      currentHeading = headingMatch[1];

      if (!KNOWN_HEADINGS.has(currentHeading)) {
        fail(
          `Unknown changelog heading "${currentHeading}". Allowed headings: ${[
            ...KNOWN_HEADINGS,
          ].join(", ")}`,
        );
      }

      if (entriesByHeading.has(currentHeading)) {
        fail(`Duplicate changelog heading "${currentHeading}"`);
      }

      continue;
    }

    if (/^#{1,6}\s+/.test(rawLine)) {
      fail(`Invalid heading in Unreleased section: ${rawLine}`);
    }

    if (currentHeading === null && rawLine.trim().length > 0) {
      fail("Unreleased content must be grouped under known ### headings");
    }

    currentLines.push(rawLine);
  }

  flush();

  if (entriesByHeading.size === 0) {
    fail("CHANGELOG.md Unreleased section is empty");
  }

  return entriesByHeading;
}

function inferBump(headings) {
  for (const heading of headings) {
    if (MAJOR_HEADINGS.has(heading)) {
      return "major";
    }
  }

  for (const heading of headings) {
    if (MINOR_HEADINGS.has(heading)) {
      return "minor";
    }
  }

  return "patch";
}

function formatReleaseNotes(entriesByHeading) {
  const sections = [];

  for (const heading of KNOWN_HEADINGS) {
    const content = entriesByHeading.get(heading);

    if (content) {
      sections.push(`### ${heading}\n\n${content}`);
    }
  }

  return `${sections.join("\n\n")}\n`;
}

const changelog = await readFile(changelogPath, "utf8");
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
const unreleased = extractUnreleased(changelog);
const entriesByHeading = parseUnreleased(unreleased);
const headings = [...entriesByHeading.keys()];
const bump = inferBump(headings);
const nextVersion = incrementVersion(pkg.version, bump);
const notes = formatReleaseNotes(entriesByHeading);

pkg.version = nextVersion;
await writeFile(`${packagePath}`, `${JSON.stringify(pkg, null, 2)}\n`);
await writeFile("release-notes.md", notes);

console.log(`RELEASE_BUMP=${bump}`);
console.log(`RELEASE_VERSION=${nextVersion}`);
console.log(`RELEASE_TAG=v${nextVersion}`);

if (process.env.GITHUB_OUTPUT) {
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `bump=${bump}\nversion=${nextVersion}\ntag=v${nextVersion}\n`,
    { flag: "a" },
  );
}
