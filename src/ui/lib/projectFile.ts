import type { Baseline } from '../../core/baseline';
import type { Project } from '../../core/model';
import { PROJECT_FILE_ACCEPT, parseProjectFile, projectFileName, serializeProjectFile } from '../../core/projectFile';
import { createDraft, getDraft } from '../../state/persistence';
import { useStore } from '../../state/store';
import { t } from '../../strings';
import { downloadText } from './download';

/*
 * Saving and opening project files (`core/projectFile.ts`). The workspace's commands, the out-of-space banner
 * and the start screen call these: "Open project file" there is `openProjectFile`, and a draft's "Download
 * project file" is `downloadDraftProjectFile`.
 */

/** Saves `project` as `<credential-name>.credential-project.json`, with its published baseline when it has one. */
export function downloadProjectFile(project: Project, baseline?: Baseline | null): void {
  downloadText(projectFileName(project), serializeProjectFile(project, baseline));
}

/** Saves the project open in the workspace, and its baseline, as a project file; does nothing on the start screen. */
export function saveProjectFile(): void {
  const { project, baseline } = useStore.getState();
  if (project) downloadProjectFile(project, baseline);
}

/** Saves stored draft `id` as a project file. Resolves false when the draft cannot be read. */
export async function downloadDraftProjectFile(id: string): Promise<boolean> {
  const record = await getDraft(id);
  if (!record) return false;
  downloadProjectFile(record.project, record.baseline);
  return true;
}

/**
 * Opens the project file `file`, with its baseline, in the workspace as a new draft, which is stored at once; the
 * draft open before stays stored. Shows the error toast and resolves false when `file` is not a project this app
 * can open.
 */
export async function openProjectFileFrom(file: Blob): Promise<boolean> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    text = '';
  }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) {
    useStore.getState().showError(parsed.error === 'newer' ? t.projectFile.newer : t.projectFile.invalid);
    return false;
  }
  createDraft(parsed.project, undefined, { baseline: parsed.baseline });
  return true;
}

/** Asks for a project file with the browser's file picker, then opens it as a new draft (`openProjectFileFrom`). */
export function openProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = PROJECT_FILE_ACCEPT;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openProjectFileFrom(file);
  });
  input.click();
}
