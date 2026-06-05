export interface AboveEditorSurface {
  render(width: number, maxRows?: number): string[];
}

export interface AboveEditorLeaseCompositor {
  requestRender?(): void;
  requestRepaint?(): void;
}

export interface AboveEditorLeaseAcquireOptions {
  owner: string;
  id: string;
  target: AboveEditorSurface;
}

export interface AboveEditorLease {
  readonly owner: string;
  readonly id: string;
  release(): void;
}

interface ActiveAboveEditorLease {
  owner: string;
  id: string;
  target: AboveEditorSurface;
  released: boolean;
}

interface AboveEditorLeaseState {
  activeCompositor: AboveEditorLeaseCompositor | null;
  activeLeases: Set<ActiveAboveEditorLease>;
}

const ABOVE_EDITOR_LEASE_STATE_KEY = Symbol.for(
  "supa-pi:pieditor:above-editor-lease-state"
);

const globalAboveEditorLeaseState = globalThis as typeof globalThis & {
  [ABOVE_EDITOR_LEASE_STATE_KEY]?: AboveEditorLeaseState;
};

globalAboveEditorLeaseState[ABOVE_EDITOR_LEASE_STATE_KEY] ??= {
  activeCompositor: null,
  activeLeases: new Set<ActiveAboveEditorLease>(),
};

const state = globalAboveEditorLeaseState[ABOVE_EDITOR_LEASE_STATE_KEY];

function normalizeLabel(value: string, fallback: string): string {
  const label = value.trim();
  return label.length > 0 ? label : fallback;
}

export function requestAboveEditorSurfaceRender(): void {
  state.activeCompositor?.requestRender?.();
  state.activeCompositor?.requestRepaint?.();
}

export function attachAboveEditorLeaseCompositor(
  compositor: AboveEditorLeaseCompositor | null
): void {
  state.activeCompositor = compositor;
}

export function acquireAboveEditorSurfaceLease(
  options: AboveEditorLeaseAcquireOptions
): AboveEditorLease {
  const lease: ActiveAboveEditorLease = {
    owner: normalizeLabel(options.owner, "unknown"),
    id: normalizeLabel(options.id, "unknown"),
    target: options.target,
    released: false,
  };

  state.activeLeases.add(lease);
  requestAboveEditorSurfaceRender();

  return {
    owner: lease.owner,
    id: lease.id,
    release() {
      if (lease.released) {
        return;
      }

      lease.released = true;
      state.activeLeases.delete(lease);
      requestAboveEditorSurfaceRender();
    },
  };
}

export function getActiveAboveEditorSurface(): AboveEditorSurface | null {
  const leases = [...state.activeLeases];
  return leases.at(-1)?.target ?? null;
}

export function clearAboveEditorSurfaceLeases(): void {
  for (const lease of state.activeLeases) {
    lease.released = true;
  }
  state.activeLeases.clear();
  requestAboveEditorSurfaceRender();
}
