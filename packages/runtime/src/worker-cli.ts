import { Store } from "./store";
import { runWorker } from "./worker";
try {
  process.loadEnvFile(".env");
} catch {}
const store = new Store(),
  abort = new AbortController();
process.on("SIGINT", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
console.log("Subtitle worker ready");
runWorker(store, abort.signal)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Worker failed");
    process.exitCode = 1;
  })
  .finally(() => store.close());
