import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBundle } from '../../../src/core/export/bundle.ts';
import { buildIssuerMetadata } from '../../../src/core/export/issuerMetadata.ts';
import { buildOutputs } from '../../../src/core/export/outputs.ts';
import { type TypeMetadata, buildTypeMetadata } from '../../../src/core/export/typeMetadata.ts';
import type { Project } from '../../../src/core/model.ts';
import { parseProjectFile } from '../../../src/core/projectFile.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/sample.credential-project.json', import.meta.url));

function runSmoke(file: string): { status: number; output: Record<string, unknown> } {
  try {
    const stdout = execFileSync(process.execPath, ['test/smoke.mjs', file], { cwd: packageDir, encoding: 'utf8' });
    return { status: 0, output: JSON.parse(stdout) };
  } catch (error) {
    const { status, stdout } = error as { status: number; stdout: string };
    return { status, output: JSON.parse(stdout) };
  }
}

describe('@bryanrmq/oca-generator', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build', '--silent'], { cwd: packageDir, stdio: 'pipe' });
  }, 60_000);

  it('runs in Node without browser globals and builds the bundle the app exports', async () => {
    const { status, output } = runSmoke(fixture);
    expect(status).toBe(0);

    const parsed = parseProjectFile(readFileSync(fixture, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const { bundle } = await buildBundle(parsed.project);
    const outputs = await buildOutputs(parsed.project, bundle);
    expect(output).toMatchObject({
      ok: true,
      issues: [],
      json: outputs.json,
      uri: 'https://example.org/oca/oca-bundle.json',
      integrity: outputs.integrity,
      vct: buildTypeMetadata(parsed.project, outputs),
      issuerMetadata: buildIssuerMetadata(parsed.project),
      roundTrip: true,
    });
  });

  it('exports the documented API', async () => {
    const entry = await import(new URL('../dist/index.js', import.meta.url).href);
    expect(Object.keys(entry).sort()).toEqual([
      'BUNDLE_FILE_NAME',
      'EXTERNAL_URL_PLACEHOLDER',
      'FALLBACK_IDENTIFIER_BASE',
      'IDENTIFIER_PATTERN',
      'ISSUER_METADATA_FILE_NAME',
      'ISSUER_METADATA_FORMAT',
      'ImportError',
      'PROJECT_FILE_EXTENSION',
      'PROJECT_FILE_FORMAT',
      'PROJECT_FILE_VERSION',
      'VCT_FILE_NAME',
      'VCT_INTEGRITY_PLACEHOLDER',
      'buildBundle',
      'buildIssuerMetadata',
      'buildOutputs',
      'buildTypeMetadata',
      'bundleDataUrl',
      'bundleIntegrity',
      'defaultIdentifiers',
      'exportProject',
      'filePlaceholders',
      'hasErrors',
      'importBundle',
      'isIssuerLogo',
      'isIssuerUrl',
      'isProject',
      'issuerIdentifiers',
      'issuerOf',
      'issuerUrl',
      'parseJsonText',
      'parseProjectFile',
      'projectFileName',
      'serializeBundle',
      'serializeIssuerMetadata',
      'serializeProjectFile',
      'serializeTypeMetadata',
      'servedTypeMetadataText',
      'servedTypeMetadataUri',
      'typeMetadataUri',
      'validate',
      'vctIntegrityCommand',
      'vctMetadataIntegrity',
    ]);
  });

  it('builds the issuer_metadata.json the app builds', async () => {
    const entry = await import(new URL('../dist/index.js', import.meta.url).href);
    const parsed = parseProjectFile(readFileSync(fixture, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const built = entry.buildIssuerMetadata(parsed.project);
    expect(built).toEqual(buildIssuerMetadata(parsed.project));
    expect(entry.ISSUER_METADATA_FILE_NAME).toBe('issuer_metadata.json');
    expect(built.metadata.credential_issuer).toBe(entry.EXTERNAL_URL_PLACEHOLDER);
  });

  it('computes vct_metadata_uri#integrity over vct.json as the generic issuer serves it', async () => {
    const entry = await import(new URL('../dist/index.js', import.meta.url).href);
    const parsed = parseProjectFile(readFileSync(fixture, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    const project: Project = { ...parsed.project, issuer: { ...parsed.project.issuer, name: parsed.project.issuer?.name ?? {}, url: 'https://issuer.example.org' } };
    const result = await entry.exportProject(project);
    expect(result.ok).toBe(true);
    const served = result.vct.text.replaceAll('${external-url}', 'https://issuer.example.org');
    const integrity = `sha256-${createHash('sha256').update(served, 'utf8').digest('base64')}`;
    const configuration = Object.values(result.issuerMetadata.metadata.credential_configurations_supported)[0] as Record<string, unknown>;
    expect(configuration['vct_metadata_uri#integrity']).toBe(integrity);
    expect(entry.filePlaceholders(result).map(({ file, placeholders }: { file: string; placeholders: { text: string }[] }) => [file, placeholders.map(({ text }) => text)])).toEqual([
      ['oca-bundle.json', []],
      ['vct.json', ['${external-url}']],
      ['issuer_metadata.json', ['${external-url}']],
    ]);
  });

  it('packs only the build, the README and package.json', () => {
    const [pack] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    ) as Array<{ files: Array<{ path: string }> }>;
    const paths = pack.files.map((file) => file.path);
    expect(paths).toContain('dist/index.js');
    expect(paths).toContain('dist/cli.js');
    expect(paths).toContain('dist/index.d.ts');
    expect(paths).toContain('README.md');
    expect(paths.filter((path) => !path.startsWith('dist/')).sort()).toEqual(['LICENSE', 'README.md', 'package.json']);
    expect(paths.some((path) => path.includes('.test.'))).toBe(false);
  });

  describe('oca command', () => {
    const work = mkdtempSync(join(tmpdir(), 'oca-cli-'));
    afterAll(() => rmSync(work, { recursive: true, force: true }));

    /** Runs the built `oca` in a child process, as an installed bin would run. */
    function oca(...args: string[]): { status: number | null; stdout: string; stderr: string } {
      const { status, stdout, stderr } = spawnSync(process.execPath, [join(packageDir, 'dist/cli.js'), ...args], { cwd: work, encoding: 'utf8' });
      return { status, stdout, stderr };
    }

    /** The sample fixture changed by `edit`, saved as a project file in the work folder. */
    function projectFile(name: string, edit: (project: Project) => void): string {
      const file = JSON.parse(readFileSync(fixture, 'utf8')) as { project: Project };
      edit(file.project);
      const path = join(work, name);
      writeFileSync(path, JSON.stringify(file));
      return path;
    }

    async function appExport(path: string) {
      const parsed = parseProjectFile(readFileSync(path, 'utf8'));
      if (!parsed.ok) throw new Error(parsed.error);
      const outputs = await buildOutputs(parsed.project, (await buildBundle(parsed.project)).bundle);
      return { outputs, vct: buildTypeMetadata(parsed.project, outputs).text };
    }

    it('builds the bundle, #integrity and Type Metadata the app exports', async () => {
      const { outputs, vct } = await appExport(fixture);

      const toFiles = oca('build', fixture, '-o', 'bundle.json', '--vct', 'vct.json');
      expect(toFiles.status).toBe(0);
      expect(readFileSync(join(work, 'bundle.json'), 'utf8')).toBe(outputs.json);
      expect(readFileSync(join(work, 'vct.json'), 'utf8')).toBe(vct);
      expect(toFiles.stdout).toContain('Wrote bundle.json');
      expect(toFiles.stdout).toContain(`uri#integrity  ${outputs.integrity}`);
      expect(toFiles.stdout).toContain('Wrote vct.json (Type Metadata)');
      expect(toFiles.stdout).not.toContain('"profile_version"');
      expect(toFiles.stderr).toBe('');

      // Without -o the bundle is all of stdout, byte for byte; the integrity and the Type Metadata go to stderr.
      const toStdout = oca('build', fixture);
      expect(toStdout.status).toBe(0);
      expect(toStdout.stdout).toBe(outputs.json);
      expect(toStdout.stderr).toContain(`uri#integrity  ${outputs.integrity}`);
      expect(toStdout.stderr).toContain(vct);
      expect(toStdout.stderr).not.toContain('\x1b['); // no colour when not a terminal

      const checked = oca('check', fixture);
      expect(checked).toEqual({ status: 0, stdout: 'No issues. The bundle is ready.\n', stderr: '' });
    });

    it('prints warnings and still builds when there are no errors', async () => {
      const path = projectFile('warnings.credential-project.json', (project) => {
        project.hosting = { mode: 'url', url: 'http://example.org/oca-bundle.json' };
      });

      const checked = oca('check', path);
      expect(checked.status).toBe(0);
      expect(checked.stdout).toBe('Warnings (1)\n  ● Hosting: The bundle URL should start with https://.\n\n1 warning.\n');

      const built = oca('build', path, '-o', 'warnings.json');
      expect(built.status).toBe(0);
      expect(built.stderr).toContain('Hosting: The bundle URL should start with https://.');
      expect(readFileSync(join(work, 'warnings.json'), 'utf8')).toBe((await appExport(path)).outputs.json);
    });

    it('prints the data URL #integrity the wallets compute when embedding', async () => {
      const path = projectFile('embedded.credential-project.json', (project) => {
        project.hosting = { mode: 'dataUrl' };
        project.meta['de-CH'] = { name: 'Führerausweis', description: 'Ausgestellt in Zürich' };
      });
      const { outputs } = await appExport(path);

      const built = oca('build', path, '-o', 'embedded.json', '--vct', 'embedded.vct.json');
      expect(built.status).toBe(0);
      const [entry] = (JSON.parse(readFileSync(join(work, 'embedded.vct.json'), 'utf8')) as TypeMetadata).display;
      // As both wallets check it: SHA-256 over the UTF-8 bytes of the whole data URL, standard base64.
      const walletIntegrity = `sha256-${createHash('sha256').update(entry.rendering.oca.uri, 'utf8').digest('base64')}`;
      expect(entry.rendering.oca.uri).toBe(outputs.dataUrl);
      expect(entry.rendering.oca['uri#integrity']).toBe(walletIntegrity);
      expect(built.stdout).toContain('uri            embedded as a data URL');
      expect(built.stdout).toContain(`uri#integrity  ${walletIntegrity}`);
    });

    it('lists errors with their location and languages, exits with 1 and writes nothing', () => {
      const path = projectFile('errors.credential-project.json', (project) => {
        const [first] = project.root.children;
        first.key = 'last name';
        first.labels = { 'de-CH': '{{nope}}', 'en-US': '{{nope}}' };
        project.languages.push('de-CH');
      });

      const checked = oca('check', path);
      expect(checked.status).toBe(1);
      expect(checked.stdout).toBe(
        [
          'Errors (3)',
          '  ● Languages: "de-CH" is listed twice.',
          '  ● last name: "last name" contains spaces or one of . [ ] { } : / " which break templates and paths.',
          '  ● last name (de-CH, en-US): "{{nope}}" does not match any attribute.',
          '',
          '3 errors.',
          '',
        ].join('\n'),
      );

      const built = oca('build', path, '-o', 'errors.json', '--vct', 'errors-vct.json');
      expect(built.status).toBe(1);
      expect(built.stderr).toContain('Errors (3)');
      expect(built.stderr).toContain('Nothing written: fix the errors first.');
      expect(built.stdout).toBe('');
      expect(existsSync(join(work, 'errors.json'))).toBe(false);
      expect(existsSync(join(work, 'errors-vct.json'))).toBe(false);
    });

    it('exits with 2 on input that is not a project file it can open', () => {
      const newer = join(work, 'newer.credential-project.json');
      writeFileSync(newer, JSON.stringify({ ...JSON.parse(readFileSync(fixture, 'utf8')), version: 99 }));

      const notProject = oca('check', join(packageDir, 'package.json'));
      expect(notProject.status).toBe(2);
      expect(notProject.stderr).toContain('is not an OCA Generator project file');
      expect(oca('build', newer).stderr).toContain('was saved by a newer OCA Generator');
      expect(oca('build', newer).status).toBe(2);
      expect(oca('check', 'missing.credential-project.json').status).toBe(2);
      expect(oca('build', fixture, '--colour').status).toBe(2);
      expect(oca('check', fixture, '-o', 'bundle.json').status).toBe(2);
      expect(oca('lint', fixture).status).toBe(2);
      expect(oca().status).toBe(2);
    });

    it('prints its help and version', () => {
      const help = oca('--help');
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('oca build <project.credential-project.json> [-o bundle.json] [--vct vct.json]');
      expect(help.stdout).toContain('Exit codes:');
      const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string };
      expect(oca('--version')).toEqual({ status: 0, stdout: `${version}\n`, stderr: '' });
    });
  });
});
