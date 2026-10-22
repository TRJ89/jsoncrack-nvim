import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const webRoot = join(repositoryRoot, "web");
const defaultDistributionDirectory = join(repositoryRoot, "dist");
const inputDirectory = join(scriptDirectory, "license-inputs");
const licenseAssetName = /^(?:license|licence|notice|copying|copyright|patents)(?:$|[._-])/i;
const workerFilename = /^reaflow-elk-worker-[A-Za-z0-9_-]+\.js$/;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const offset = lockPath.lastIndexOf(marker);
  if (offset < 0) throw new Error(`Invalid npm lockfile package path: ${lockPath}`);
  return lockPath.slice(offset + marker.length);
}

function resolveDependencyPath(parentPath, name, packageEntries) {
  let directory = parentPath;
  while (true) {
    const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`;
    if (Object.hasOwn(packageEntries, candidate)) return candidate;
    if (!directory) return null;
    const marker = "/node_modules/";
    const offset = directory.lastIndexOf(marker);
    directory = offset < 0 ? "" : directory.slice(0, offset);
  }
}

export function collectRuntimePackagePaths(lockfile) {
  const packageEntries = lockfile?.packages;
  const rootPackage = packageEntries?.[""];
  if (!packageEntries || !rootPackage) {
    throw new Error("The npm lockfile must use package-lock v2/v3 package entries.");
  }

  const visited = new Set();
  const visiting = new Set();
  const visit = (packagePath) => {
    if (visited.has(packagePath)) return;
    if (visiting.has(packagePath)) return;
    const packageEntry = packageEntries[packagePath];
    if (!packageEntry || packageEntry.dev === true) return;
    visiting.add(packagePath);

    const dependencies = packageEntry.dependencies ?? {};
    const optionalDependencies = packageEntry.optionalDependencies ?? {};
    if (typeof dependencies !== "object" || typeof optionalDependencies !== "object") {
      throw new Error(`Invalid dependency entries in npm lockfile at ${packagePath}.`);
    }
    const names = new Set([...Object.keys(dependencies), ...Object.keys(optionalDependencies)]);
    for (const dependencyName of [...names].sort()) {
      const optional = Object.hasOwn(optionalDependencies, dependencyName);
      const dependencyPath = resolveDependencyPath(packagePath, dependencyName, packageEntries);
      if (!dependencyPath) {
        if (optional) continue;
        throw new Error(
          `The required runtime dependency ${dependencyName} from ${packagePath} is absent from the lockfile.`,
        );
      }
      if (packageEntries[dependencyPath].dev === true) continue;
      visit(dependencyPath);
    }

    visiting.delete(packagePath);
    visited.add(packagePath);
  };

  const directDependencies = rootPackage.dependencies ?? {};
  const optionalDependencies = rootPackage.optionalDependencies ?? {};
  const directNames = new Set([...Object.keys(directDependencies), ...Object.keys(optionalDependencies)]);
  for (const dependencyName of [...directNames].sort()) {
    const optional = Object.hasOwn(optionalDependencies, dependencyName);
    const packagePath = resolveDependencyPath("", dependencyName, packageEntries);
    if (!packagePath) {
      if (optional) continue;
      throw new Error(`The required root runtime dependency ${dependencyName} is absent from the lockfile.`);
    }
    if (packageEntries[packagePath].dev !== true) visit(packagePath);
  }

  return [...visited].sort();
}

async function readSupplementalInputs() {
  const evidence = JSON.parse(
    await readFile(join(inputDirectory, "supplemental-license-evidence.json"), "utf8"),
  );
  const mitTemplate = await readFile(join(inputDirectory, evidence.mitTemplate.file));
  const elkLicense = await readFile(join(inputDirectory, evidence.embeddedWorker.licenseFile));
  if (sha256(mitTemplate) !== evidence.mitTemplate.sha256) {
    throw new Error("The SPDX MIT template does not match its pinned evidence hash.");
  }
  if (sha256(elkLicense) !== evidence.embeddedWorker.licenseSha256) {
    throw new Error("The elkjs 0.10.0 EPL-2.0 text does not match its pinned evidence hash.");
  }
  return { evidence, mitTemplate, elkLicense };
}

function outputLicenseText(content, source, outputFiles) {
  const digest = sha256(content);
  const file = `licenses/${digest}.txt`;
  outputFiles.set(file, content);
  return { file, sha256: digest, ...source };
}

function validatePackageMetadata(lockPath, packageEntry) {
  const name = packageNameFromLockPath(lockPath);
  if (typeof packageEntry.version !== "string" || !packageEntry.version) {
    throw new Error(`Runtime package has no exact version in the lockfile: ${lockPath}`);
  }
  if (typeof packageEntry.license !== "string" || !packageEntry.license) {
    throw new Error(`Runtime package has no license expression in the lockfile: ${name}@${packageEntry.version}`);
  }
  if (typeof packageEntry.resolved !== "string" || !packageEntry.resolved) {
    throw new Error(`Runtime package has no resolved source URL in the lockfile: ${name}@${packageEntry.version}`);
  }
  if (typeof packageEntry.integrity !== "string" || !packageEntry.integrity) {
    throw new Error(`Runtime package has no integrity in the lockfile: ${name}@${packageEntry.version}`);
  }
  return name;
}

async function packageLicenseAssets(packageDirectory, outputFiles) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => licenseAssetName.test(entry.name))
    .sort((left, right) => compareText(left.name, right.name));
  const assets = [];
  for (const entry of candidates) {
    if (!entry.isFile()) {
      throw new Error(`A package license/notice asset is not a regular file: ${packageDirectory}/${entry.name}`);
    }
    const content = await readFile(join(packageDirectory, entry.name));
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error(`A package license/notice asset is not valid UTF-8: ${packageDirectory}/${entry.name}`);
    }
    assets.push(
      outputLicenseText(content, {
        sourceKind: "installed-package",
        pathInPackage: entry.name,
      }, outputFiles),
    );
  }
  return assets;
}

async function buildPackageRecords(lockfile, supplemental, outputFiles) {
  const paths = collectRuntimePackagePaths(lockfile);
  const records = [];
  for (const lockPath of paths) {
    const packageEntry = lockfile.packages[lockPath];
    const name = validatePackageMetadata(lockPath, packageEntry);
    const packageDirectory = resolve(webRoot, lockPath);
    const packageRelative = relative(join(webRoot, "node_modules"), packageDirectory);
    if (packageRelative.startsWith(`..${sep}`) || packageRelative === ".." || packageRelative.startsWith(sep)) {
      throw new Error(`Runtime package path escapes web/node_modules: ${lockPath}`);
    }
    const packageKey = `${name}@${packageEntry.version}`;
    let licenseFiles = await packageLicenseAssets(packageDirectory, outputFiles);
    let supplementalAttribution;

    if (!licenseFiles.length) {
      const sourceEvidence = supplemental.evidence.packages?.[packageKey];
      if (!sourceEvidence) {
        throw new Error(`Runtime package has no license text or pinned supplement: ${packageKey}`);
      }
      if (packageEntry.license !== sourceEvidence.license || sourceEvidence.license !== "MIT") {
        throw new Error(`The supplemental license evidence does not match the lockfile for ${packageKey}`);
      }
      const template = supplemental.evidence.mitTemplate;
      licenseFiles = [
        outputLicenseText(supplemental.mitTemplate, {
          sourceKind: "canonical-license-template",
          source: template.source,
          sourceUrl: template.sourceUrl,
          sourceCommit: template.sourceCommit,
          note: template.note,
        }, outputFiles),
      ];
      supplementalAttribution = sourceEvidence;
    }

    records.push({
      name,
      version: packageEntry.version,
      license: packageEntry.license,
      lockPath,
      resolved: packageEntry.resolved,
      integrity: packageEntry.integrity,
      installedPackagePath: `web/${lockPath}`,
      licenseFiles,
      ...(supplementalAttribution ? { supplementalAttribution } : {}),
    });
  }
  records.sort((left, right) =>
    compareText(left.name, right.name) ||
    compareText(left.version, right.version) ||
    compareText(left.lockPath, right.lockPath),
  );
  return records;
}

async function buildEmbeddedWorkerArtifact(distributionDirectory, packageRecords, supplemental, outputFiles) {
  const workerEvidence = supplemental.evidence.embeddedWorker;
  const reaflow = packageRecords.find(
    (record) => record.name === "reaflow" && record.version === workerEvidence.reaflowVersion,
  );
  if (!reaflow) throw new Error(`Runtime lock closure is missing reaflow@${workerEvidence.reaflowVersion}.`);

  const elkjsVersions = packageRecords
    .filter((record) => record.name === workerEvidence.sourcePackage)
    .map((record) => ({ version: record.version, lockPath: record.lockPath }));
  if (!elkjsVersions.length) throw new Error("Runtime lock closure is missing the installed elkjs package.");

  const assetDirectory = join(distributionDirectory, "assets");
  const assets = (await readdir(assetDirectory)).filter((name) => workerFilename.test(name));
  if (assets.length !== 1) throw new Error(`Expected one emitted Reaflow worker asset; found ${assets.length}.`);
  const emittedBytes = await readFile(join(assetDirectory, assets[0]));
  const firstLineEnd = emittedBytes.indexOf(0x0a);
  if (firstLineEnd < 0) throw new Error("The emitted Reaflow worker asset is missing its provenance comment.");
  const provenanceComment = emittedBytes.subarray(0, firstLineEnd).toString("utf8");
  const payload = emittedBytes.subarray(firstLineEnd + 1);
  if (!provenanceComment.startsWith("/* Derived from Reaflow 5.4.1") || !provenanceComment.includes("elkjs@0.10.0")) {
    throw new Error("The emitted worker provenance comment is missing or incorrect.");
  }
  if (sha256(payload) !== workerEvidence.payloadSha256 || gitBlobSha1(payload) !== workerEvidence.payloadGitBlobSha1) {
    throw new Error("The emitted worker payload does not match the pinned elkjs 0.10.0 source.");
  }

  const reaflowRoot = resolve(webRoot, reaflow.lockPath);
  const source = await readFile(join(reaflowRoot, "dist", "index.js"), "utf8");
  const workerDataUrl = /new URL\("data:application\/javascript;base64,([A-Za-z0-9+/]+={0,2})", self\.location\)/g;
  const matches = [...source.matchAll(workerDataUrl)];
  if (matches.length !== 1 || !matches[0][1]) {
    throw new Error("Could not confirm the source worker embedded in the pinned Reaflow package.");
  }
  const originalPayload = Buffer.from(matches[0][1], "base64");
  if (sha256(originalPayload) !== workerEvidence.payloadSha256 || !originalPayload.equals(payload)) {
    throw new Error("The emitted worker differs from Reaflow's pinned embedded worker payload.");
  }

  const elkLicenseFile = outputLicenseText(supplemental.elkLicense, {
    sourceKind: "pinned-upstream-license",
    source: "elkjs 0.10.0 LICENSE.md",
    sourceUrl: workerEvidence.sourceUrl,
    sourceCommit: workerEvidence.sourceCommit,
  }, outputFiles);
  const licenseFiles = [...reaflow.licenseFiles, elkLicenseFile];
  const artifactFile = `assets/${assets[0]}`;
  return {
    name: workerEvidence.name,
    file: artifactFile,
    license: "Apache-2.0 (Reaflow) and EPL-2.0 (embedded ELK worker)",
    licenseFiles,
    payloadSha256: workerEvidence.payloadSha256,
    payloadGitBlobSha1: workerEvidence.payloadGitBlobSha1,
    embeddedSource: {
      package: workerEvidence.sourcePackage,
      version: workerEvidence.sourceVersion,
      path: workerEvidence.sourcePath,
      sourceUrl: workerEvidence.sourceUrl,
      sourceCommit: workerEvidence.sourceCommit,
      sourceArchive: workerEvidence.sourceArchive,
      elkSourceUrl: workerEvidence.elkSourceUrl,
      elkSourceCommit: workerEvidence.elkSourceCommit,
      elkSourceArchive: workerEvidence.elkSourceArchive,
      license: workerEvidence.license,
      note: workerEvidence.note,
    },
    relatedLockedPackages: [
      { name: reaflow.name, version: reaflow.version, lockPath: reaflow.lockPath },
      ...elkjsVersions.map(({ version, lockPath }) => ({ name: workerEvidence.sourcePackage, version, lockPath })),
    ],
  };
}

function projectLicenseArtifact(rootLicense, outputFiles) {
  const license = outputLicenseText(rootLicense, {
    sourceKind: "project-license",
    pathInRepository: "LICENSE",
  }, outputFiles);
  return {
    name: "JsonCrack Preview for Neovim project license",
    license: "MIT",
    licenseFiles: [license],
  };
}

function markdownNotices(packageRecords, artifacts, evidence) {
  const workerEvidence = evidence.embeddedWorker;
  const lines = [
    "# Third-Party Notices",
    "",
    "This distribution includes the production dependency closure recorded in `web/package-lock.json`.",
    "Each license and notice file under `licenses/` is copied byte-for-byte from the pinned package, or is explicitly identified below as a supplemental canonical text. `THIRD-PARTY-NOTICES.json` records the package version, lockfile path, registry URL, integrity, source file, and SHA-256 mapping for every text.",
    "",
    "## Project license",
    "",
    "JsonCrack Preview for Neovim is licensed under MIT. The project license text is included at `LICENSE` in the source checkout and copied into the distribution license files.",
    "",
    "## Embedded Reaflow ELK worker",
    "",
    `The emitted asset is derived from Reaflow ${workerEvidence.reaflowVersion} and includes an ELK worker whose original bytes match \`${workerEvidence.sourcePackage}@${workerEvidence.sourceVersion}/${workerEvidence.sourcePath}\` (Git blob SHA-1 \`${workerEvidence.payloadGitBlobSha1}\`, SHA-256 \`${workerEvidence.payloadSha256}\`). Reaflow is licensed under Apache-2.0; the embedded worker carries EPL-2.0 attribution. The separately installed lockfile package is ${packageRecords.filter((record) => record.name === workerEvidence.sourcePackage).map((record) => `\`${workerEvidence.sourcePackage}@${record.version}\``).join(", ")}; it is distinct from the embedded worker source version.`,
    "",
    `The worker source is available in the pinned [elkjs ${workerEvidence.sourceVersion} source archive](${workerEvidence.sourceArchive}) at commit \`${workerEvidence.sourceCommit}\`. The generated worker is based on the corresponding [Eclipse ELK ${workerEvidence.sourceVersion} source archive](${workerEvidence.elkSourceArchive}) at commit \`${workerEvidence.elkSourceCommit}\`. These references identify the source; the EPL-2.0 text is included with this distribution.`,
    "",
    `License text files for this asset: ${artifacts.find((artifact) => artifact.name === workerEvidence.name).licenseFiles.map((license) => `\`${license.file}\``).join(", ")}.`,
    "",
    "## Runtime package licenses",
    "",
    "| Package instance | SPDX expression | License/notice texts | Resolved source |",
    "| --- | --- | --- | --- |",
  ];

  for (const record of packageRecords) {
    const textFiles = record.licenseFiles.map((license) => {
      const source = license.pathInPackage ? ` (${license.pathInPackage})` : " (supplemental MIT template)";
      return `\`${license.file}\`${source}`;
    }).join("<br>");
    const resolved = record.resolved.replaceAll("|", "%7C");
    lines.push(
      `| \`${record.name}@${record.version}\`<br>\`${record.lockPath}\` | ${record.license.replaceAll("|", "&#124;")} | ${textFiles} | [registry source](${resolved}) |`,
    );
  }

  const supplementalRecords = packageRecords.filter((record) => record.supplementalAttribution);
  if (supplementalRecords.length) {
    lines.push("", "## Supplemental MIT source evidence", "");
    lines.push(
      "The following exact pinned package source trees declare MIT but contain no license text. The shared text is the canonical SPDX v3.29.0 MIT template, not a file shipped by those upstream packages. The package-specific statements below preserve only source-supplied facts; no missing copyright year or holder has been inferred.",
      "",
    );
    for (const record of supplementalRecords) {
      const source = record.supplementalAttribution;
      const author = source.author ? ` Author: ${source.author}.` : " The pinned manifest has no author field.";
      const statement = source.readmeLicenseStatement === "MIT ©"
        ? ` README fragment: \`${source.readmeLicenseStatement}\`.`
        : source.readmeLicenseStatement
          ? ` README statement: ${source.readmeLicenseStatement}`
          : " The pinned README contains no license or copyright statement.";
      lines.push(
        `- \`${record.name}@${record.version}\`: [pinned source](${source.sourceUrl}) at \`${source.sourceCommit}\`.${author}${statement} ${source.note}`,
      );
    }
    lines.push(
      "",
      `Template source: [${evidence.mitTemplate.source}](${evidence.mitTemplate.sourceUrl}) at commit \`${evidence.mitTemplate.sourceCommit}\`; the copied text retains its \`<year> <copyright holders>\` placeholders.`,
    );
  }

  lines.push("", "## Project license text", "");
  for (const artifact of artifacts.filter((value) => value.name === "JsonCrack Preview for Neovim project license")) {
    for (const license of artifact.licenseFiles) lines.push(`- \`${license.file}\` — ${license.license ?? "MIT"}.`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function generateNotices({ distributionDirectory = defaultDistributionDirectory } = {}) {
  const lockfile = JSON.parse(await readFile(join(webRoot, "package-lock.json"), "utf8"));
  const projectLicense = await readFile(join(repositoryRoot, "LICENSE"));
  const supplemental = await readSupplementalInputs();
  const outputFiles = new Map();
  const packageRecords = await buildPackageRecords(lockfile, supplemental, outputFiles);

  const projectArtifact = projectLicenseArtifact(projectLicense, outputFiles);
  const workerArtifact = await buildEmbeddedWorkerArtifact(
    resolve(distributionDirectory),
    packageRecords,
    supplemental,
    outputFiles,
  );
  const artifacts = [projectArtifact, workerArtifact];
  const manifest = {
    version: 1,
    generatedFrom: "web/package-lock.json",
    packages: packageRecords,
    artifacts,
  };
  const markdown = markdownNotices(packageRecords, artifacts, supplemental.evidence);

  await rm(join(resolve(distributionDirectory), "licenses"), { recursive: true, force: true });
  await mkdir(join(resolve(distributionDirectory), "licenses"), { recursive: true });
  for (const [path, content] of [...outputFiles].sort(([left], [right]) => left.localeCompare(right))) {
    await writeFile(join(resolve(distributionDirectory), path), content);
  }
  await writeFile(join(resolve(distributionDirectory), "THIRD-PARTY-NOTICES.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(resolve(distributionDirectory), "THIRD-PARTY-NOTICES.md"), markdown);
  return { packageCount: packageRecords.length, licenseCount: outputFiles.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const distributionDirectory = process.argv[2]
      ? resolve(process.argv[2])
      : defaultDistributionDirectory;
    const result = await generateNotices({ distributionDirectory });
    console.log(`Generated notices for ${result.packageCount} runtime package instances and ${result.licenseCount} license texts.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
