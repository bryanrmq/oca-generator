import { describe, expect, it } from 'vitest';
import type { Baseline } from './baseline';
import { type Project, emptyProject, newAttribute, newGroupLink } from './model';
import { PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, parseProjectFile, projectFileName, serializeProjectFile } from './projectFile';

/** A project with every part a bundle leaves out: the sample credential, an I14Y link and the issuer settings. */
function fullProject(): Project {
  const project = emptyProject(['de-CH', 'fr-CH']);
  project.meta['de-CH'] = { name: 'Hundebewilligung', description: 'Für Hundehalter' };
  project.meta['fr-CH'] = { name: 'Permis pour chien', description: '' };
  const canton = newAttribute('canton', {
    labels: { 'de-CH': 'Kanton', 'fr-CH': 'Canton' },
    i14y: {
      conceptId: '08d94604-5a6f-4e8f-9b5f-0123456789ab',
      identifier: 'CH_CANTON',
      registrationStatus: 'Recorded',
      name: { de: 'Kanton', fr: 'Canton' },
      publisher: { de: 'BFS' },
      values: { BE: { de: 'Bern', fr: 'Berne' } },
    },
    entries: { codes: ['BE'], labels: { 'de-CH': { BE: 'Bern' }, 'fr-CH': { BE: 'Berne' } } },
  });
  const holder = newGroupLink('holder', { source: ['holder'] });
  holder.group.children.push(newAttribute('name'));
  project.root.children.push(canton, holder);
  project.sample = { canton: 'BE', holder: { name: 'Seraina' } };
  project.hosting = { mode: 'url', url: 'https://example.ch/oca' };
  project.bundleExtras = { x_note: 'kept' };
  project.issuer = {
    name: { 'de-CH': 'Kanton Bern', 'fr-CH': 'Canton de Berne' },
    logo: 'data:image/png;base64,iVBORw0KGgo=',
    url: 'https://issuer.example.ch',
    configurationId: 'dog_permit_sd_jwt',
    typeKey: 'dog-permit-v01',
  };
  return project;
}

const file = (content: unknown) => JSON.stringify(content);

const baseline: Baseline = { json: '{"capture_bases":[]}', integrity: 'sha256-abc=', source: 'download', setAt: 1_700_000_000_000 };

describe('project files', () => {
  it('round-trips every part of a project, the sample and I14Y links included', () => {
    const project = fullProject();
    const parsed = parseProjectFile(serializeProjectFile(project));
    expect(parsed).toEqual({ ok: true, project });
  });

  it('keeps the issuer settings, and opens a file saved before them without adding them', () => {
    const project = fullProject();
    const parsed = parseProjectFile(serializeProjectFile(project));
    expect(parsed.ok && parsed.project.issuer).toEqual(project.issuer);

    const { issuer: _issuer, ...before } = project;
    const older = parseProjectFile(file({ format: PROJECT_FILE_FORMAT, version: 1, project: before }));
    expect(older).toEqual({ ok: true, project: before });
    expect(older.ok && 'issuer' in older.project).toBe(false);
  });

  it('writes the format and the version around the project', () => {
    const project = fullProject();
    const content = JSON.parse(serializeProjectFile(project));
    expect(Object.keys(content)).toEqual(['format', 'version', 'project']);
    expect(content.format).toBe('credential-toolkit-project');
    expect(content.format).toBe(PROJECT_FILE_FORMAT);
    expect(content.version).toBe(1);
    expect(content.version).toBe(PROJECT_FILE_VERSION);
  });

  it('round-trips the published baseline next to the project', () => {
    const project = fullProject();
    const text = serializeProjectFile(project, baseline);
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'version', 'project', 'baseline']);
    expect(parseProjectFile(text)).toEqual({ ok: true, project, baseline });
    expect(serializeProjectFile(project, null)).toBe(serializeProjectFile(project));
  });

  it('opens a file saved before baselines, and leaves out a baseline that is not one', () => {
    const project = fullProject();
    const older = parseProjectFile(file({ format: PROJECT_FILE_FORMAT, version: 1, project }));
    expect(older).toEqual({ ok: true, project });
    expect(older.ok && 'baseline' in older).toBe(false);
    const broken = parseProjectFile(file({ format: PROJECT_FILE_FORMAT, version: 1, project, baseline: { json: 1 } }));
    expect(broken.ok && 'baseline' in broken).toBe(false);
    expect(broken).toEqual({ ok: true, project });
  });

  it('names the file after the credential name in the first language', () => {
    const project = fullProject();
    expect(projectFileName(project)).toBe('hundebewilligung.credential-project.json');
    project.meta['de-CH'].name = '  Führerausweis: Kat. B / C1 ';
    expect(projectFileName(project)).toBe('fuhrerausweis-kat-b-c1.credential-project.json');
    project.meta['de-CH'].name = 'Élève – Carte d’étudiant 2026';
    expect(projectFileName(project)).toBe('eleve-carte-d-etudiant-2026.credential-project.json');
    project.meta['de-CH'].name = 'a'.repeat(100);
    expect(projectFileName(project)).toBe(`${'a'.repeat(80)}.credential-project.json`);
  });

  it('names a file without a credential name untitled-credential', () => {
    const project = fullProject();
    project.meta['de-CH'].name = '';
    expect(projectFileName(project)).toBe('untitled-credential.credential-project.json');
    project.meta['de-CH'].name = '—?!';
    expect(projectFileName(project)).toBe('untitled-credential.credential-project.json');
    expect(projectFileName(emptyProject([]))).toBe('untitled-credential.credential-project.json');
  });

  it('refuses what is not a project file', () => {
    const project = fullProject();
    for (const text of [
      '',
      'not json',
      '[]',
      'null',
      file(project),
      file({ version: 1, project }),
      file({ format: 'something-else', version: 1, project }),
      file({ format: PROJECT_FILE_FORMAT, project }),
      file({ format: PROJECT_FILE_FORMAT, version: '1', project }),
      file({ format: PROJECT_FILE_FORMAT, version: 0, project }),
      file({ format: PROJECT_FILE_FORMAT, version: 1.5, project }),
      file({ format: PROJECT_FILE_FORMAT, version: 1 }),
      file({ format: PROJECT_FILE_FORMAT, version: 1, project: { ...project, root: null } }),
      file({ format: PROJECT_FILE_FORMAT, version: 1, project: { ...project, version: 2 } }),
      file({ format: PROJECT_FILE_FORMAT, version: 1, project: { ...project, languages: 'de-CH' } }),
    ]) {
      expect(parseProjectFile(text), text).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('refuses a file saved by a newer version', () => {
    const project = fullProject();
    expect(parseProjectFile(file({ format: PROJECT_FILE_FORMAT, version: 2, project }))).toEqual({ ok: false, error: 'newer' });
    expect(parseProjectFile(file({ format: PROJECT_FILE_FORMAT, version: 99, project: 'anything' }))).toEqual({ ok: false, error: 'newer' });
  });
});
