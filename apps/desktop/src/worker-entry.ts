import { Store } from "@subtitle/runtime";
import { runWorker } from "../../../packages/runtime/src/worker";
const abort = new AbortController();
process.on("SIGTERM", () => abort.abort());
runWorker(new Store(), abort.signal).catch(() => process.exit(1));
