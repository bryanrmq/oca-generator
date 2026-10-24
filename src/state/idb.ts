/** A thin promise wrapper over IndexedDB, with just what the drafts need. */

const DB_NAME = 'credential-toolkit';
const DB_VERSION = 1;

/** Whole drafts, by id: `DraftRecord` in `persistence.ts`. */
export const DRAFTS_STORE = 'drafts';
/** What the drafts list shows, by id, so listing never reads the project bodies (logos can be large). */
export const SUMMARIES_STORE = 'summaries';

/** Opens the database, creating its stores the first time. Rejects when the browser has no IndexedDB or refuses it. */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFTS_STORE, { keyPath: 'id' });
      request.result.createObjectStore(SUMMARIES_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs `work` in one transaction over `stores` and resolves with the result of the request it returns once
 * the transaction commits. Rejects when it aborts, a full disk among the reasons; then none of its writes
 * happened, so a failed save never leaves a draft half written.
 */
export function transact<T = undefined>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let request: IDBRequest<T> | void;
    transaction.oncomplete = () => resolve(request ? request.result : (undefined as T));
    transaction.onabort = () => reject(transaction.error ?? new Error('The transaction was aborted.'));
    try {
      request = work(transaction);
    } catch (error) {
      reject(error);
      transaction.abort();
    }
  });
}
