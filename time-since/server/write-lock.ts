const writes = new Map<string, Promise<void>>();

// Serializes read-modify-write cycles on one file within this process.
export function withWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(filePath) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const finished = current.then(
    () => undefined,
    () => undefined,
  );
  writes.set(filePath, finished);
  return current.finally(() => {
    if (writes.get(filePath) === finished) writes.delete(filePath);
  });
}
