// Prints the FEES block for docs/google-sheet-script.gs from the PUBLISHED catalogue (Expansion Stage B).
//
// The Apps Script keeps its own copy of every programme's local NGN fee, keyed by programme NAME, to check bank-transfer
// applications and for its own emails. It is deployed by the owner in Google, so this script changes nothing there: it
// prints the block to paste after the catalogue changes (and after a build has refreshed lib/catalogue.published.ts).
// The Worker never relies on these values; it prices every registration from the database catalogue.
//
//   npm run sheet:fees            print the block
//   npm run sheet:fees -- --check exit 1 if docs/google-sheet-script.gs is out of step with the published catalogue
import { readFileSync } from "node:fs";
import { PROGRAMMES, CATALOGUE_SOURCE } from "../lib/config.ts";

export const feesBlock = () => `var FEES = {\n${PROGRAMMES.map((p) => `  ${JSON.stringify(p.name)}: ${p.price}`).join(",\n")}\n};`;

const block = feesBlock();
if (process.argv.includes("--check")) {
  const gs = readFileSync(new URL("../docs/google-sheet-script.gs", import.meta.url), "utf8");
  const current = gs.match(/var FEES = \{[\s\S]*?\};/)?.[0] ?? "";
  if (current.replace(/\s+/g, "") !== block.replace(/\s+/g, "")) {
    console.error(`FEES in docs/google-sheet-script.gs differs from the published catalogue (${CATALOGUE_SOURCE}). Expected:\n${block}`);
    process.exit(1);
  }
  console.log(`FEES matches the published catalogue (${CATALOGUE_SOURCE}, ${PROGRAMMES.length} programmes).`);
} else {
  console.log(`// From the published catalogue (${CATALOGUE_SOURCE}), ${new Date().toISOString().slice(0, 10)}. Paste over var FEES in the Apps Script.\n${block}`);
}
