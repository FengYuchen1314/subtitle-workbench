import { Service, Store } from "@subtitle/runtime";
const globalStore = globalThis as unknown as { subtitleService?: Service };
export function getService() {
  return (globalStore.subtitleService ||= new Service(new Store()));
}
