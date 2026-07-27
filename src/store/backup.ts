import type { Database } from '../domain/types';
import { parseDatabase } from './store';

export interface BackupResult {
  ok: boolean;
  message: string;
}

function fileName(): string {
  return `doings-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * Writes the whole database to a file the user picks. The desktop build uses a
 * native save dialog; the browser falls back to a download.
 */
export async function exportDatabase(db: Database): Promise<BackupResult> {
  const json = JSON.stringify({ version: 1, db }, null, 2);
  const native = window.desktop?.storage;

  if (native) {
    const path = await native.export(json);
    return path
      ? { ok: true, message: `Копия сохранена: ${path}` }
      : { ok: false, message: 'Сохранение отменено' };
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName();
  link.click();
  URL.revokeObjectURL(url);
  return { ok: true, message: `Файл ${fileName()} загружен` };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(file);
  });
}

/** Asks the user for a file and returns a validated database. */
export async function pickDatabase(): Promise<{ db?: Database; message: string }> {
  const native = window.desktop?.storage;
  let text: string | null = null;

  if (native) {
    text = await native.import();
  } else {
    text = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        resolve(file ? await readFileAsText(file) : null);
      });
      // Cancelling a file input fires nothing in older engines, so also listen here.
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  if (!text) return { message: 'Импорт отменён' };

  try {
    const db = parseDatabase(JSON.parse(text));
    if (!db) return { message: 'Файл не похож на базу приложения' };
    return { db, message: `Загружено задач: ${db.todos.length}` };
  } catch {
    return { message: 'Не удалось прочитать JSON' };
  }
}
