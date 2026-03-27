import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..");

const HELP_TEXT = `Usage: node scripts/verify-standalone.mjs [options]

Options:
  --pack-file <path>   Reuse an existing tarball instead of creating one
  --temp-dir <path>    Use a specific temp directory
  --keep-temp          Keep the temp directory after a successful run
  --help, -h           Show this help message
`;

const FORBIDDEN_TEXT_CHECKS = [
  {
    pattern: /tests\/interactive-login\.ts/g,
    reason: "external auth helper",
  },
  {
    pattern: /pnpm local:up/g,
    reason: "repo-root bootstrap command",
  },
  {
    pattern: /\.\.\/playwright/g,
    reason: "parent-directory auth path",
  },
  {
    pattern: /\bwebprobe\b/gi,
    reason: "stale pre-rename product name",
  },
];

const PACKAGE_TEXT_PATHS = [
  "README.md",
  "dramaturge.config.example.json",
  "examples",
  "docs",
];

export function buildVerifyStandaloneHelpText() {
  return HELP_TEXT;
}

export function parseVerifyStandaloneArgs(args) {
  let keepTemp = false;
  let packFile;
  let tempDir;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return { keepTemp, packFile, showHelp: true, tempDir };
    }

    if (arg === "--keep-temp") {
      keepTemp = true;
      continue;
    }

    if (arg === "--pack-file") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --pack-file");
      }
      packFile = value;
      i++;
      continue;
    }

    if (arg === "--temp-dir") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --temp-dir");
      }
      tempDir = value;
      i++;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { keepTemp, packFile, showHelp: false, tempDir };
}

function resolveCommand(command) {
  if (process.platform === "win32" && command === "pnpm") {
    return "pnpm.cmd";
  }

  return command;
}

function quoteForWindowsCmd(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[ \t"&()<>^|]/.test(value)) {
    return value;
  }

  return `"${value.replace(/(["^])/g, "^$1")}"`;
}

function runCommand(command, args, options = {}) {
  const result =
    process.platform === "win32" && command === "pnpm"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            [command, ...args].map(quoteForWindowsCmd).join(" "),
          ],
          {
            cwd: options.cwd,
            encoding: "utf-8",
            stdio: "pipe",
          }
        )
      : spawnSync(resolveCommand(command), args, {
          cwd: options.cwd,
          encoding: "utf-8",
          stdio: "pipe",
        });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${
        output ? `\n${output}` : ""
      }`
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function collectTextFiles(packageDir, relativePath, files) {
  const absolutePath = join(packageDir, relativePath);
  if (!existsSync(absolutePath)) {
    return;
  }

  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolutePath)) {
      collectTextFiles(packageDir, join(relativePath, entry), files);
    }
    return;
  }

  if (/\.(md|json|jsonc)$/i.test(relativePath)) {
    files.push(relativePath.replace(/\\/g, "/"));
  }
}

export function scanPackageTextFiles(packageDir) {
  const files = [];
  for (const relativePath of PACKAGE_TEXT_PATHS) {
    collectTextFiles(packageDir, relativePath, files);
  }

  const issues = [];
  for (const file of files) {
    const contents = readFileSync(join(packageDir, file), "utf-8");

    for (const check of FORBIDDEN_TEXT_CHECKS) {
      if (check.pattern.test(contents)) {
        issues.push({
          file,
          reason: check.reason,
        });
      }
      check.pattern.lastIndex = 0;
    }

    const isConfigLikeFile =
      file === "dramaturge.config.example.json" ||
      file.startsWith("examples/");

    if (isConfigLikeFile && contents.includes("../")) {
      issues.push({
        file,
        reason: "parent-directory config path",
      });
    }
  }

  return issues;
}

function formatIssues(issues) {
  return issues
    .map((issue) => `- ${issue.file}: ${issue.reason}`)
    .join("\n");
}

function findPackedTarball(packDir) {
  const tarballs = readdirSync(packDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort();

  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one tarball in ${packDir}, found ${tarballs.length}`
    );
  }

  return join(packDir, tarballs[0]);
}

function getInstalledPackageDir(consumerDir, packageName) {
  return join(consumerDir, "node_modules", ...packageName.split("/"));
}

function loadPackageMetadata(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8"));
}

function verifyInstalledConfigLoad(consumerDir, packageName, installedPackageDir) {
  const verificationScript = `
    import { createRequire } from "node:module";
    import { dirname, join, resolve } from "node:path";
    import { loadConfig } from ${JSON.stringify(packageName)};

    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(${JSON.stringify(`${packageName}/package.json`)});
    const packageDir = dirname(packageJsonPath);
    const examplePath = join(packageDir, "examples", "standalone.local.profile.jsonc");
    const config = loadConfig(examplePath);

    if (config.auth.type !== "interactive") {
      throw new Error("Expected standalone.local profile to use interactive auth");
    }

    const expectedPrefix = resolve(packageDir).replace(/\\\\/g, "/");
    const stateFile = config.auth.stateFile.replace(/\\\\/g, "/");
    const outputDir = config.output.dir.replace(/\\\\/g, "/");

    if (!stateFile.startsWith(expectedPrefix)) {
      throw new Error("Resolved auth.stateFile escaped the installed package directory");
    }

    if (!outputDir.startsWith(expectedPrefix)) {
      throw new Error("Resolved output.dir escaped the installed package directory");
    }

    console.log(JSON.stringify({
      examplePath,
      installedPackageDir: packageDir,
      stateFile: config.auth.stateFile,
      outputDir: config.output.dir,
    }));
  `;

  const result = runCommand(
    process.execPath,
    ["--input-type=module", "-e", verificationScript],
    { cwd: consumerDir }
  );

  const packageDirFromOutput = JSON.parse(result.stdout.trim()).installedPackageDir;
  if (
    realpathSync.native(packageDirFromOutput) !==
    realpathSync.native(installedPackageDir)
  ) {
    throw new Error("Installed package directory did not match the resolved package path");
  }
}

export async function runStandaloneVerification(
  args = process.argv.slice(2),
  io = console
) {
  const parsed = parseVerifyStandaloneArgs(args);
  if (parsed.showHelp) {
    io.log(buildVerifyStandaloneHelpText());
    return 0;
  }

  const tempRoot = parsed.tempDir
    ? resolve(parsed.tempDir)
    : mkdtempSync(join(tmpdir(), "dramaturge-standalone-"));
  const packDir = join(tempRoot, "pack");
  const consumerDir = join(tempRoot, "consumer");
  const keepTempOnExit = parsed.keepTemp;
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  try {
    const tarballPath = parsed.packFile
        ? resolve(parsed.packFile)
      : (() => {
          io.log("Packing Dramaturge into a standalone tarball...");
          runCommand("pnpm", ["pack", "--pack-destination", packDir], {
            cwd: PACKAGE_DIR,
          });
          return findPackedTarball(packDir);
        })();

    if (!existsSync(tarballPath)) {
      throw new Error(`Tarball not found: ${tarballPath}`);
    }

    io.log(`Installing ${tarballPath} into an isolated temp directory...`);
    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify(
        {
          name: "dramaturge-standalone-smoke",
          private: true,
          type: "module",
        },
        null,
        2
      ),
      "utf-8"
    );

    runCommand("pnpm", ["add", tarballPath], { cwd: consumerDir });

    const packageMetadata = loadPackageMetadata(PACKAGE_DIR);
    const packageName = packageMetadata.name;
    const installedPackageDir = getInstalledPackageDir(consumerDir, packageName);
    if (!existsSync(installedPackageDir)) {
      throw new Error(
        `Installed package directory was not found at ${installedPackageDir}`
      );
    }

    const issues = scanPackageTextFiles(installedPackageDir);
    if (issues.length > 0) {
      throw new Error(
        `Found standalone packaging issues:\n${formatIssues(issues)}`
      );
    }

    io.log("Running CLI smoke check...");
    runCommand("pnpm", ["exec", "dramaturge", "--help"], { cwd: consumerDir });

    io.log("Loading the packaged standalone example...");
    verifyInstalledConfigLoad(consumerDir, packageName, installedPackageDir);

    io.log(
      `Standalone verification succeeded.\nTarball: ${tarballPath}\nTemp directory: ${tempRoot}`
    );

    if (!keepTempOnExit) {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    return 0;
  } catch (error) {
    io.error(
      `Standalone verification failed in ${tempRoot}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return 1;
  }
}

const executedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executedDirectly) {
  const exitCode = await runStandaloneVerification();
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
