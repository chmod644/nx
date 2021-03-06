import { exec, execSync } from 'child_process';
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'fs';
import { ensureDirSync } from 'fs-extra';
import * as path from 'path';

interface RunCmdOpts {
  silenceError?: boolean;
  env?: Record<string, string>;
}

export let cli;

export function uniq(prefix: string) {
  return `${prefix}${Math.floor(Math.random() * 10000000)}`;
}

export function forEachCli(
  selectedCliOrFunction: string | Function,
  callback?: (currentCLIName) => void
) {
  let clis;
  if (process.env.SELECTED_CLI && selectedCliOrFunction && callback) {
    if (selectedCliOrFunction == process.env.SELECTED_CLI) {
      clis = [process.env.SELECTED_CLI];
    } else {
      clis = [];
    }
  } else if (process.env.SELECTED_CLI) {
    clis = [process.env.SELECTED_CLI];
  } else {
    clis = callback ? [selectedCliOrFunction] : ['nx', 'angular'];
  }

  const cb: any = callback ? callback : selectedCliOrFunction;
  clis.forEach(c => {
    describe(`[${c}]`, () => {
      beforeEach(() => {
        cli = c;
      });
      cb(c);
    });
  });
}

export function patchKarmaToWorkOnWSL(): void {
  try {
    const karma = readFile('karma.conf.js');
    if (process.env['WINDOWSTMP']) {
      updateFile(
        'karma.conf.js',
        karma.replace(
          `const { constants } = require('karma');`,
          `
      const { constants } = require('karma');
      process.env['TMPDIR']="${process.env['WINDOWSTMP']}";
    `
        )
      );
    }
  } catch (e) {}
}

export function workspaceConfigName() {
  return cli === 'angular' ? 'angular.json' : 'workspace.json';
}

function patchPackageJsonDeps(addWorkspace = true) {
  const p = JSON.parse(readFileSync(tmpProjPath('package.json')).toString());
  const workspacePath = path.join(getCwd(), 'build', 'packages', 'workspace');
  const angularPath = path.join(getCwd(), 'build', 'packages', 'angular');
  const reactPath = path.join(getCwd(), 'build', 'packages', 'react');
  const storybookPath = path.join(getCwd(), 'build', 'packages', 'storybook');
  const jestPath = path.join(getCwd(), 'build', 'packages', 'jest');

  if (addWorkspace) {
    p.devDependencies['@nrwl/workspace'] = `file:${workspacePath}`;
  }
  p.devDependencies['@nrwl/angular'] = `file:${angularPath}`;
  p.devDependencies['@nrwl/react'] = `file:${reactPath}`;
  p.devDependencies['@nrwl/storybook'] = `file:${storybookPath}`;
  p.devDependencies['@nrwl/jest'] = `file:${jestPath}`;
  writeFileSync(tmpProjPath('package.json'), JSON.stringify(p, null, 2));
}

export function runYarnInstall(silent: boolean = true) {
  const install = execSync('yarn install', {
    cwd: tmpProjPath(),
    ...(silent ? { stdio: ['ignore', 'ignore', 'ignore'] } : {})
  });
  return install ? install.toString() : '';
}

export function runNgcc(silent: boolean = true, async: boolean = true) {
  const install = execSync(
    'node ./node_modules/@angular/compiler-cli/ngcc/main-ngcc.js' +
      (!async ? ' --async=false' : ''),
    {
      cwd: tmpProjPath(),
      ...(silent ? { stdio: ['ignore', 'ignore', 'ignore'] } : {})
    }
  );
  return install ? install.toString() : '';
}

/**
 * Run the `new` command for the currently selected CLI
 *
 * @param args Extra arguments to pass to the `new` command
 * @param silent Run in silent mode (no output)
 * @param addWorkspace Include `@nrwl/workspace` when patching the `package.json` paths
 */
export function runNew(
  args?: string,
  silent?: boolean,
  addWorkspace = true
): string {
  let gen;
  if (cli === 'angular') {
    gen = execSync(
      `../../node_modules/.bin/ng new proj --no-interactive --skip-install ${args ||
        ''}`,
      {
        cwd: `./tmp/${cli}`,
        ...(silent ? { stdio: ['ignore', 'ignore', 'ignore'] } : {})
      }
    );
  } else {
    gen = execSync(
      `node ../../node_modules/@nrwl/tao/index.js new proj --no-interactive --skip-install ${args ||
        ''}`,
      {
        cwd: `./tmp/${cli}`,
        ...(silent && false ? { stdio: ['ignore', 'ignore', 'ignore'] } : {})
      }
    );
  }

  patchPackageJsonDeps(addWorkspace);
  const install = runYarnInstall(silent && false);
  return silent ? null : `${gen ? gen.toString() : ''}${install}`;
}

/**
 * Sets up a new project in the temporary project path
 * for the currently selected CLI.
 */
export function newProject(): void {
  cleanup();
  if (!directoryExists(tmpBackupProjPath())) {
    runNew('--collection=@nrwl/workspace --npmScope=proj', true);
    copyMissingPackages();

    writeFileSync(
      tmpProjPath(
        'node_modules/@angular-devkit/schematics/tasks/node-package/executor.js'
      ),
      `
      "use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rxjs_1 = require("rxjs");
function default_1(factoryOptions = {}) {
    return (options) => {
        return new rxjs_1.Observable(obs => {
          obs.complete();
        });
    };
}
exports.default = default_1;`
    );
    const inCI = process.env['CIRCLECI'] ? true : false;
    runNgcc(!inCI, !inCI);

    execSync(`mv ${tmpProjPath()} ${tmpBackupProjPath()}`);
  }
  execSync(`cp -a ${tmpBackupProjPath()} ${tmpProjPath()}`);
}

/**
 * Ensures that a project has been setup
 * in the temporary project path for the
 * currently selected CLI.
 *
 * If one is not found, it creates a new project.
 */
export function ensureProject(): void {
  if (!directoryExists(tmpProjPath())) {
    newProject();
  }
}

export function supportUi() {
  return false;
  // return !process.env.NO_CHROME;
}

export function copyMissingPackages(): void {
  const modulesToCopy = [
    '@ngrx',
    '@nrwl',
    'angular',
    '@angular',
    '@angular-devkit',
    'codelyzer',
    'ngrx-store-freeze',
    'npm-run-all',
    'yargs',
    'yargs-parser',

    'ng-packagr',
    'cypress',
    '@jest',
    'jest',
    '@types/jest',
    '@types/node',
    'jest-preset-angular',
    'identity-obj-proxy',
    'karma',
    'karma-chrome-launcher',
    'karma-coverage-istanbul-reporter',
    'karma-jasmine',
    'karma-jasmine-html-reporter',
    'jasmine-core',
    'jasmine-spec-reporter',
    'jasmine-marbles',
    '@types/jasmine',
    '@types/jasminewd2',
    '@nestjs',
    'express',
    '@types/express',
    'protractor',

    'react',
    'react-dom',
    'react-router-dom',
    'styled-components',
    '@types/react',
    '@types/react-dom',
    '@types/react-router-dom',
    '@testing-library',

    // For testing webpack config with babel-loader
    '@babel',
    '@svgr/webpack',
    'babel-loader',
    'babel-plugin-const-enum',
    'babel-plugin-macros',
    'eslint-plugin-import',
    'eslint-plugin-jsx-a11y',
    'eslint-plugin-react',
    'eslint-plugin-react-hooks',
    'url-loader',

    // For testing web bundle
    'rollup',
    '@rollup',
    'rollup-plugin-babel',
    'rollup-plugin-filesize',
    'rollup-plugin-local-resolve',
    'rollup-plugin-peer-deps-external',
    'rollup-plugin-postcss',
    'rollup-plugin-typescript2',

    'next',
    'document-register-element',

    '@angular/forms',
    '@storybook',

    'fork-ts-checker-webpack-plugin',

    // For web builder with inlined build-angular
    'source-map',
    'webpack-sources',
    'terser',
    'caniuse-lite',
    'browserslist',
    'license-webpack-plugin',
    'webpack-subresource-integrity',
    'autoprefixer',
    'mini-css-extract-plugin',
    'postcss-import',
    'worker-plugin',
    'regenerator-runtime',
    'clean-css',
    'loader-utils',
    'postcss',
    'url',
    'circular-dependency-plugin',
    'terser-webpack-plugin',
    'parse5',
    'cacache',
    'find-cache-dir',
    'tree-kill',
    'speed-measure-webpack-plugin',
    'webpack-merge',
    'semver',

    'css-loader',
    'mime',
    'less',
    'send',

    '@bazel'
  ];
  modulesToCopy.forEach(m => copyNodeModule(m));
  updateFile(
    'node_modules/@angular-devkit/schematics/tasks/node-package/executor.js',
    `
    function default_1() {
      return () => {
        const rxjs = require("rxjs");
        return new rxjs.Observable(obs => {
          obs.next();
          obs.complete();
        });
      };
    }
    exports.default = default_1;
  `
  );

  execSync(`rm -rf ${tmpProjPath('node_modules/.bin/webpack')}`);
  execSync(
    `cp -a node_modules/.bin/webpack ${tmpProjPath(
      'node_modules/.bin/webpack'
    )}`
  );

  execSync(`rm -rf ${tmpProjPath('node_modules/.bin/bazel')}`);
  execSync(
    `cp -a node_modules/.bin/bazel ${tmpProjPath('node_modules/.bin/bazel')}`
  );
  execSync(`rm -rf ${tmpProjPath('node_modules/cypress/node_modules/@types')}`);
  execSync(`rm -rf node_modules/karma/node_modules/mime`);
  execSync(`rm -rf node_modules/ng-packagr/node_modules/mime`);
}

function copyNodeModule(name: string) {
  execSync(`rm -rf ${tmpProjPath('node_modules/' + name)}`);
  execSync(`cp -a node_modules/${name} ${tmpProjPath('node_modules/' + name)}`);
}

export function runCommandAsync(
  command: string,
  opts: RunCmdOpts = {
    silenceError: false,
    env: process.env
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      `${command}`,
      {
        cwd: tmpProjPath()
      },
      (err, stdout, stderr) => {
        if (!opts.silenceError && err) {
          reject(err);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export function runCLIAsync(
  command: string,
  opts: RunCmdOpts = {
    silenceError: false,
    env: process.env
  }
): Promise<{ stdout: string; stderr: string }> {
  return runCommandAsync(
    `node ./node_modules/@nrwl/cli/bin/nx.js ${command}`,
    opts
  );
}

export function runNgAdd(
  command?: string,
  opts: RunCmdOpts = {
    silenceError: false,
    env: process.env
  }
): string {
  try {
    return execSync(`./node_modules/.bin/ng ${command}`, {
      cwd: tmpProjPath(),
      env: opts.env
    })
      .toString()
      .replace(
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ''
      );
  } catch (e) {
    if (opts.silenceError) {
      return e.stdout.toString();
    } else {
      console.log(e.stdout.toString(), e.stderr.toString());
      throw e;
    }
  }
}

export function runCLI(
  command?: string,
  opts: RunCmdOpts = {
    silenceError: false,
    env: process.env
  }
): string {
  try {
    const r = execSync(`node ./node_modules/@nrwl/cli/bin/nx.js ${command}`, {
      cwd: tmpProjPath(),
      env: opts.env
    })
      .toString()
      .replace(
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ''
      );
    console.log(r);

    const needsMaxWorkers = /g.*(express|nest|node|web|react):app.*/;
    if (needsMaxWorkers.test(command)) {
      setMaxWorkers();
    }

    return r;
  } catch (e) {
    if (opts.silenceError) {
      return e.stdout.toString();
    } else {
      console.log(e.stdout.toString(), e.stderr.toString());
      throw e;
    }
  }
}

export function expectTestsPass(v: { stdout: string; stderr: string }) {
  expect(v.stderr).toContain('Ran all test suites');
  expect(v.stderr).not.toContain('fail');
}

export function runCommand(command: string): string {
  try {
    const r = execSync(command, {
      cwd: tmpProjPath(),
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString();
    console.log(r);
    return r;
  } catch (e) {
    return e.stdout.toString() + e.stderr.toString();
  }
}

/**
 * Sets maxWorkers in CircleCI on all projects that require it
 * so that it doesn't try to run it with 34 workers
 *
 * maxWorkers required for: node, web, jest
 */
function setMaxWorkers() {
  if (process.env['CIRCLECI']) {
    const workspaceFile = workspaceConfigName();
    const workspace = readJson(workspaceFile);

    Object.keys(workspace.projects).forEach(appName => {
      const {
        architect: { build }
      } = workspace.projects[appName];

      if (!build) {
        return;
      }

      if (
        build.builder.startsWith('@nrwl/node') ||
        build.builder.startsWith('@nrwl/web') ||
        build.builder.startsWith('@nrwl/jest')
      ) {
        build.options.maxWorkers = 4;
      }
    });

    updateFile(workspaceFile, JSON.stringify(workspace));
  }
}

export function updateFile(f: string, content: string | Function): void {
  ensureDirSync(path.dirname(tmpProjPath(f)));
  if (typeof content === 'string') {
    writeFileSync(tmpProjPath(f), content);
  } else {
    writeFileSync(
      tmpProjPath(f),
      content(readFileSync(tmpProjPath(f)).toString())
    );
  }
}

export function renameFile(f: string, newPath: string): void {
  ensureDirSync(path.dirname(tmpProjPath(newPath)));
  renameSync(tmpProjPath(f), tmpProjPath(newPath));
}

export function checkFilesExist(...expectedFiles: string[]) {
  expectedFiles.forEach(f => {
    const ff = f.startsWith('/') ? f : tmpProjPath(f);
    if (!exists(ff)) {
      throw new Error(`File '${ff}' does not exist`);
    }
  });
}

export function checkFilesDoNotExist(...expectedFiles: string[]) {
  expectedFiles.forEach(f => {
    const ff = f.startsWith('/') ? f : tmpProjPath(f);
    if (exists(ff)) {
      throw new Error(`File '${ff}' does not exist`);
    }
  });
}

export function listFiles(dirName: string) {
  return readdirSync(tmpProjPath(dirName));
}

export function readJson(f: string): any {
  return JSON.parse(readFile(f));
}

export function readFile(f: string) {
  const ff = f.startsWith('/') ? f : tmpProjPath(f);
  return readFileSync(ff).toString();
}

export function cleanup() {
  execSync(`rm -rf ${tmpProjPath()}`);
}

export function rmDist() {
  execSync(`rm -rf ${tmpProjPath()}/dist`);
}

export function getCwd(): string {
  return process.cwd();
}

export function directoryExists(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch (err) {
    return false;
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch (err) {
    return false;
  }
}

export function exists(filePath: string): boolean {
  return directoryExists(filePath) || fileExists(filePath);
}

export function getSize(filePath: string): number {
  return statSync(filePath).size;
}

export function tmpProjPath(path?: string) {
  return path ? `./tmp/${cli}/proj/${path}` : `./tmp/${cli}/proj`;
}

function tmpBackupProjPath(path?: string) {
  return path ? `./tmp/${cli}/proj-backup/${path}` : `./tmp/${cli}/proj-backup`;
}
