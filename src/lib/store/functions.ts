import { createServerFn } from "@tanstack/react-start";
import type {
  CatalogueProductRow,
  CatalogueSettings,
  CatalogueVariantRow,
} from "./catalogue";

/** Serializable response passed from the server to the browser. */
export type PublicCatalogue = {
  products: CatalogueProductRow[];
  variants: CatalogueVariantRow[];
  settings: CatalogueSettings | null;
};

/**
 * Keep server-only database access behind the TanStack Start RPC boundary.
 * Do not import `client.server` from this shared module: state.tsx is used by
 * the browser and causes this module to enter the client dependency graph.
 */
export const getPublicCatalogue = createServerFn({ method: "POST" }).handler(
  async (): Promise<PublicCatalogue> => {
    const { fetchPublicCatalogue } = await import("./functions.server");
    return await fetchPublicCatalogue();
  },
);

/** Empty data shape for callers that need a safe initial snapshot. */
export function snapshotPublicCatalogue(): PublicCatalogue {
  return { products: [], variants: [], settings: null };
}
