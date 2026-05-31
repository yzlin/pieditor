import type { ReplacementLeaseAcquireOptions } from "./fixed-editor/replacement-lease.js";

export interface ReplacementLeaseModule {
  hasReplacementLeaseCompositor(): boolean;
  withReplacementSurfaceLease<T>(
    options: ReplacementLeaseAcquireOptions,
    run: () => Promise<T>
  ): Promise<T>;
}

export type {
  ReplacementLease,
  ReplacementLeaseAcquireOptions,
  ReplacementLeaseCompositor,
  ReplacementLeaseDiagnostic,
  ReplacementSurface,
} from "./fixed-editor/replacement-lease.js";
export {
  acquireReplacementSurfaceLease,
  attachReplacementLeaseCompositor,
  clearReplacementSurfaceLeases,
  getActiveReplacementLeaseDiagnostics,
  getActiveReplacementSurface,
  hasReplacementLeaseCompositor,
  isReplacementSurfaceLeased,
  withReplacementSurfaceLease,
} from "./fixed-editor/replacement-lease.js";
