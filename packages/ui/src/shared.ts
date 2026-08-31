export type Command = (
  method: string,
  args?: Record<string, unknown>,
) => Promise<any>;
export function quiet(promise: Promise<unknown>) {
  void promise.catch(() => {});
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export const languages = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["pt", "Português"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
].map(([value, label]) => ({ value, label }));
// A blur autosave must finish before the following export/render click.
export function createCommandQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task);
    tail = next.catch(() => {});
    return next;
  };
}
