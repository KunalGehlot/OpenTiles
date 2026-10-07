#!/usr/bin/env node
// Licence scanner (P2-16). Lists the licences of everything OpenTiles ships and checks them
// against an allowlist compatible with AGPL-3.0-or-later (docs/development.md hard rule 7):
//
// - npm: the production dependency tree of every workspace package (`pnpm licenses list --prod`),
//   which covers apps/web, apps/sync-api, apps/ios-shell and packages/*;
// - Cargo: every crate in Cargo.lock that the engine workspace resolves (`cargo metadata`, which
//   reads manifests only and builds nothing);
// - vendored assets under apps/web/public, declared in tools/licences/assets.json.
//
// Reviewed cases that the allowlist cannot decide go in tools/licences/exceptions.json with a
// reason. Exit codes: 0 all clear, 1 a licence is unknown or not allowed, 2 the scan itself failed.
//
// Usage: node tools/check-licences.mjs [--skip-npm] [--skip-cargo] [--skip-assets] [--verbose]

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  coveringAsset,
  evaluateFindings,
  licenceTextProblem,
  validateExceptions,
} from './licences/policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');

class ScanError extends Error {}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) throw new ScanError(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ScanError(
      `${command} ${commandArgs.join(' ')} exited with ${result.status}:\n${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/** @returns {import('./licences/policy.mjs').Finding[]} */
function npmFindings() {
  const report = JSON.parse(run('pnpm', ['licenses', 'list', '--json', '--prod']));
  const findings = [];
  for (const [licence, packages] of Object.entries(report)) {
    for (const pkg of packages) {
      for (const version of pkg.versions ?? ['?']) {
        findings.push({
          ecosystem: 'npm',
          name: pkg.name,
          version,
          licence: pkg.license ?? licence,
          where: pkg.paths?.[0] ? relative(root, pkg.paths[0]) : undefined,
        });
      }
    }
  }
  return findings;
}

/** @returns {import('./licences/policy.mjs').Finding[]} */
function cargoFindings() {
  const metadata = JSON.parse(
    run('cargo', [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--manifest-path',
      join(root, 'Cargo.toml'),
    ]),
  );
  const members = new Set(metadata.workspace_members);
  return metadata.packages
    .filter((pkg) => !members.has(pkg.id))
    .map((pkg) => ({
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      // A crate with only `license-file` has no SPDX expression: it needs a reviewed exception.
      licence: pkg.license ?? (pkg.license_file ? `license-file: ${pkg.license_file}` : null),
    }));
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

/**
 * Every file under the asset roots must be covered by a declared entry, and every entry's licence
 * file must exist and read like the licence it claims.
 */
function assetFindings() {
  const config = JSON.parse(readFileSync(join(root, 'tools/licences/assets.json'), 'utf8'));
  const findings = [];
  const problems = [];
  const counts = new Map(config.assets.map((entry) => [entry, 0]));
  for (const assetRoot of config.roots) {
    const abs = join(root, assetRoot);
    if (!existsSync(abs)) continue;
    for (const file of listFiles(abs)) {
      const rel = relative(root, file).split(sep).join('/');
      const entry = coveringAsset(rel, config.assets);
      if (entry) counts.set(entry, (counts.get(entry) ?? 0) + 1);
      else problems.push(`${rel}: no entry in tools/licences/assets.json covers this file`);
    }
  }
  for (const entry of config.assets) {
    if (counts.get(entry) === 0) {
      problems.push(`${entry.path}: declared in assets.json but no such file; remove the entry`);
      continue;
    }
    if (!entry.licenceFile || !existsSync(join(root, entry.licenceFile))) {
      problems.push(`${entry.path}: licence file ${entry.licenceFile ?? '(none named)'} missing`);
    } else {
      const textProblem = licenceTextProblem(
        entry.licence,
        readFileSync(join(root, entry.licenceFile), 'utf8'),
      );
      if (textProblem) problems.push(`${entry.path}: ${textProblem} (${entry.licenceFile})`);
    }
    if (!entry.source) problems.push(`${entry.path}: say where the asset comes from ("source")`);
    findings.push({
      ecosystem: 'asset',
      name: entry.path,
      version: `${counts.get(entry)} file(s)`,
      licence: entry.licence,
      where: entry.source,
    });
  }
  return { findings, problems };
}

function main() {
  const findings = [];
  const assetProblems = [];
  if (!args.has('--skip-npm')) findings.push(...npmFindings());
  if (!args.has('--skip-cargo')) findings.push(...cargoFindings());
  if (!args.has('--skip-assets')) {
    const assets = assetFindings();
    findings.push(...assets.findings);
    assetProblems.push(...assets.problems);
  }

  const exceptions = validateExceptions(
    JSON.parse(readFileSync(join(root, 'tools/licences/exceptions.json'), 'utf8')),
  );
  const { results, unusedExceptions } = evaluateFindings(findings, exceptions);

  // Summary: how many packages per ecosystem and licence.
  const summary = new Map();
  for (const r of results) {
    const key = `${r.ecosystem}\t${r.licence ?? '(none)'}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  console.log('Licence scan (allowlist: tools/licences/spdx.mjs)\n');
  for (const [key, count] of [...summary].sort()) {
    const [ecosystem, licence] = key.split('\t');
    console.log(`  ${ecosystem.padEnd(6)} ${String(count).padStart(4)}  ${licence}`);
  }
  if (verbose) {
    console.log('');
    for (const r of results) {
      console.log(
        `  [${r.status}] ${r.ecosystem} ${r.name}@${r.version}: ${r.licence} (${r.detail})`,
      );
    }
  }

  const excepted = results.filter((r) => r.status === 'excepted');
  if (excepted.length > 0) {
    console.log('\nAccepted by a reviewed exception:');
    for (const r of excepted) {
      console.log(`  ${r.ecosystem} ${r.name}@${r.version}: ${r.licence} (${r.detail})`);
    }
  }
  if (unusedExceptions.length > 0) {
    console.log('\nWarning: these exceptions match nothing any more; remove them:');
    for (const e of unusedExceptions) console.log(`  ${e.ecosystem} ${e.name}: ${e.licence}`);
  }

  const rejected = results.filter((r) => r.status === 'rejected');
  const failures = rejected.length + assetProblems.length;
  if (failures === 0) {
    console.log(`\nAll ${results.length} entries have an allowed licence.`);
    return 0;
  }
  console.error(`\n${failures} licence problem(s):`);
  for (const r of rejected) {
    console.error(`  ${r.ecosystem} ${r.name}@${r.version}: "${r.licence ?? ''}" — ${r.detail}`);
    if (r.where) console.error(`      at ${r.where}`);
  }
  for (const problem of assetProblems) console.error(`  asset ${problem}`);
  console.error(
    '\nSee "Licences of dependencies and assets" in CONTRIBUTING.md for how to resolve this.',
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof ScanError || error instanceof SyntaxError) {
    console.error(`Licence scan failed: ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
