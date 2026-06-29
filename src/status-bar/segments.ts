import { hostname as osHostname } from "node:os";
import { basename } from "node:path";

import { visibleWidth } from "@earendil-works/pi-tui";

import { getIcons, getThinkingText, SEP_DOT } from "./icons.js";
import { applyColor, fg, rainbow } from "./theme.js";
import type {
  RenderedSegment,
  SemanticColor,
  StatusBarContext,
  StatusBarRenderMode,
  StatusBarSegment,
  StatusBarSegmentId,
} from "./types.js";

const TRAILING_STATUS_DECORATION_PATTERN_SOURCE = String.raw`(\u001B\[[0-9;]*m|\s|·|\|)+$`;
const TRAILING_STATUS_DECORATION_PATTERN = new RegExp(
  TRAILING_STATUS_DECORATION_PATTERN_SOURCE
);

const THINKING_LEVEL_TEXT: Record<string, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

function color(
  ctx: StatusBarContext,
  semantic: SemanticColor,
  text: string
): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number): string {
  if (n < 1000) {
    return n.toString();
  }
  if (n < 10_000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}k`;
  }
  if (n < 10_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(n / 1_000_000)}M`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatTime(ctx: StatusBarContext): string {
  const opts = ctx.options.time ?? {};
  const now = new Date();

  let hours = now.getHours();
  let suffix = "";
  if (opts.format === "12h") {
    suffix = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
  }

  const mins = now.getMinutes().toString().padStart(2, "0");
  let timeStr = `${hours}:${mins}`;
  if (opts.showSeconds) {
    timeStr += `:${now.getSeconds().toString().padStart(2, "0")}`;
  }
  return `${timeStr}${suffix}`;
}

function getTotalTokens(ctx: StatusBarContext): number {
  return (
    ctx.usageStats.input +
    ctx.usageStats.output +
    ctx.usageStats.cacheRead +
    ctx.usageStats.cacheWrite
  );
}

function getThinkingLevelText(level: string): string {
  return THINKING_LEVEL_TEXT[level] || level;
}

function renderThinkingContent(
  ctx: StatusBarContext,
  level: string,
  content: string
): RenderedSegment {
  if (level === "high" || level === "xhigh") {
    return { content: rainbow(content), visible: true };
  }
  return { content: color(ctx, "thinking", content), visible: true };
}

function renderCompactToken(
  ctx: StatusBarContext,
  label: string,
  value: number
): RenderedSegment {
  if (!value) {
    return { content: "", visible: false };
  }
  return {
    content: color(ctx, "tokens", `${label}:${formatTokens(value)}`),
    visible: true,
  };
}

function getModelName(ctx: StatusBarContext): string {
  let modelName = ctx.model?.name || ctx.model?.id || "no-model";
  if (modelName.startsWith("Claude ")) {
    modelName = modelName.slice(7);
  }
  return modelName;
}

function getPathText(ctx: StatusBarContext, compact = false): string {
  const opts = ctx.options.path ?? {};
  const mode = compact ? "basename" : (opts.mode ?? "basename");

  let pwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE;

  if (mode === "basename") {
    return basename(pwd) || pwd;
  }

  if (home && pwd.startsWith(home)) {
    pwd = `~${pwd.slice(home.length)}`;
  }

  if (pwd.startsWith("/work/")) {
    pwd = pwd.slice(6);
  }

  if (mode === "abbreviated") {
    const maxLen = opts.maxLength ?? 40;
    if (pwd.length > maxLen) {
      pwd = `…${pwd.slice(-(maxLen - 1))}`;
    }
  }

  return pwd;
}

function stripCavemanPrefix(status: string): string {
  return status.replace(/^🪨\s*/, "");
}

function getShortHostname(): string {
  return osHostname().split(".")[0] || "host";
}

const piSegment: StatusBarSegment = {
  id: "pi",
  render(ctx) {
    const icons = getIcons();
    if (!icons.pi) {
      return { content: "", visible: false };
    }
    return { content: color(ctx, "pi", `${icons.pi} `), visible: true };
  },
  renderCompact(ctx) {
    const icons = getIcons();
    if (!icons.pi) {
      return { content: "", visible: false };
    }
    return { content: color(ctx, "pi", icons.pi), visible: true };
  },
};

const FAST_MODE_EXTENSION_STATUS_KEY = "fast";
const FAST_MODE_EXTENSION_STATUS_TEXT = "⚡ fast";
const FAST_MODE_EXTENSION_UNSUPPORTED_STATUS_TEXT = "⚡ fast*";
const FAST_MODE_MODEL_STATUS_TEXT = "⚡";
const FAST_MODE_MODEL_UNSUPPORTED_STATUS_TEXT = "⚡*";

function resolveFastModeModelStatus(ctx: StatusBarContext): string | null {
  const status = ctx.extensionStatuses.get(FAST_MODE_EXTENSION_STATUS_KEY);
  if (status === FAST_MODE_EXTENSION_STATUS_TEXT) {
    return FAST_MODE_MODEL_STATUS_TEXT;
  }
  if (status === FAST_MODE_EXTENSION_UNSUPPORTED_STATUS_TEXT) {
    return FAST_MODE_MODEL_UNSUPPORTED_STATUS_TEXT;
  }

  return null;
}

const modelSegment: StatusBarSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};

    const modelName = getModelName(ctx);

    let content = withIcon(icons.model, modelName);
    const fastModeStatus = resolveFastModeModelStatus(ctx);
    if (fastModeStatus) {
      content += ` ${fastModeStatus}`;
    }
    if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      if (level !== "off") {
        const thinkingText = getThinkingText(level);
        if (thinkingText) {
          content += `${SEP_DOT}${thinkingText}`;
        }
      }
    }

    return { content: color(ctx, "model", content), visible: true };
  },
  renderCompact(ctx) {
    let content = getModelName(ctx);
    const fastModeStatus = resolveFastModeModelStatus(ctx);
    if (fastModeStatus) {
      content += ` ${fastModeStatus}`;
    }
    return { content: color(ctx, "model", content), visible: true };
  },
};

const pathSegment: StatusBarSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    return {
      content: color(ctx, "path", withIcon(icons.folder, getPathText(ctx))),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return {
      content: color(ctx, "path", getPathText(ctx, true)),
      visible: true,
    };
  },
};

const gitSegment: StatusBarSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const hasChanges = staged > 0 || unstaged > 0 || untracked > 0;
    const gitStatus = hasChanges ? { staged, unstaged, untracked } : null;

    if (!(branch || gitStatus)) {
      return { content: "", visible: false };
    }

    const showBranch = opts.showBranch !== false;
    const branchColor: SemanticColor = hasChanges ? "gitDirty" : "gitClean";

    let content = "";
    if (showBranch && branch) {
      content = color(ctx, branchColor, withIcon(icons.branch, branch));
    }

    if (gitStatus) {
      const indicators: string[] = [];
      if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
        indicators.push(
          applyColor(ctx.theme, "warning", `*${gitStatus.unstaged}`)
        );
      }
      if (opts.showStaged !== false && gitStatus.staged > 0) {
        indicators.push(
          applyColor(ctx.theme, "success", `+${gitStatus.staged}`)
        );
      }
      if (opts.showUntracked !== false && gitStatus.untracked > 0) {
        indicators.push(
          applyColor(ctx.theme, "muted", `?${gitStatus.untracked}`)
        );
      }
      if (indicators.length > 0) {
        const indicatorText = indicators.join(" ");
        if (!content && showBranch === false) {
          content =
            color(ctx, branchColor, icons.git ? `${icons.git} ` : "") +
            indicatorText;
        } else {
          content += content ? ` ${indicatorText}` : indicatorText;
        }
      }
    }

    return content
      ? { content, visible: true }
      : { content: "", visible: false };
  },
  renderCompact(ctx) {
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const hasChanges = staged > 0 || unstaged > 0 || untracked > 0;
    if (!(branch || hasChanges)) {
      return { content: "", visible: false };
    }

    const parts: string[] = [];
    if (opts.showBranch !== false && branch) {
      parts.push(branch);
    }
    if (opts.showUnstaged !== false && unstaged > 0) {
      parts.push(`*${unstaged}`);
    }
    if (opts.showStaged !== false && staged > 0) {
      parts.push(`+${staged}`);
    }
    if (opts.showUntracked !== false && untracked > 0) {
      parts.push(`?${untracked}`);
    }

    const branchColor: SemanticColor = hasChanges ? "gitDirty" : "gitClean";
    return parts.length
      ? { content: color(ctx, branchColor, parts.join(" ")), visible: true }
      : { content: "", visible: false };
  },
};

const thinkingSegment: StatusBarSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";
    return renderThinkingContent(
      ctx,
      level,
      `think:${getThinkingLevelText(level)}`
    );
  },
  renderCompact(ctx) {
    const level = ctx.thinkingLevel || "off";
    return renderThinkingContent(ctx, level, getThinkingLevelText(level));
  },
};

const CAVEMAN_EXTENSION_STATUS_KEY = "caveman";

const cavemanSegment: StatusBarSegment = {
  id: "caveman",
  render(ctx) {
    const status = ctx.extensionStatuses.get(CAVEMAN_EXTENSION_STATUS_KEY);
    if (!status || visibleWidth(status) <= 0) {
      return { content: "", visible: false };
    }

    return {
      content: color(ctx, "thinking", status),
      visible: true,
    };
  },
  renderCompact(ctx) {
    const status = ctx.extensionStatuses.get(CAVEMAN_EXTENSION_STATUS_KEY);
    if (!status || visibleWidth(status) <= 0) {
      return { content: "", visible: false };
    }

    return {
      content: color(ctx, "thinking", stripCavemanPrefix(status)),
      visible: true,
    };
  },
};

const tokenInSegment: StatusBarSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.usageStats.input) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "tokens",
        withIcon(icons.input, formatTokens(ctx.usageStats.input))
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return renderCompactToken(ctx, "I", ctx.usageStats.input);
  },
};

const tokenOutSegment: StatusBarSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.usageStats.output) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "tokens",
        withIcon(icons.output, formatTokens(ctx.usageStats.output))
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return renderCompactToken(ctx, "O", ctx.usageStats.output);
  },
};

const tokenTotalSegment: StatusBarSegment = {
  id: "token_total",
  render(ctx) {
    const icons = getIcons();
    const total = getTotalTokens(ctx);
    if (!total) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "tokens",
        withIcon(icons.tokens, formatTokens(total))
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return renderCompactToken(ctx, "T", getTotalTokens(ctx));
  },
};

const costSegment: StatusBarSegment = {
  id: "cost",
  render(ctx) {
    const { cost } = ctx.usageStats;
    if (!(cost || ctx.usingSubscription)) {
      return { content: "", visible: false };
    }

    const costDisplay = ctx.usingSubscription ? "(sub)" : `$${cost.toFixed(2)}`;
    return { content: color(ctx, "cost", costDisplay), visible: true };
  },
};

const contextPctSegment: StatusBarSegment = {
  id: "context_pct",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.contextWindow) {
      return { content: "", visible: false };
    }
    const text = `${ctx.contextPercent.toFixed(1)}%/${formatTokens(ctx.contextWindow)}`;

    if (ctx.contextPercent > 90) {
      return {
        content: withIcon(icons.context, color(ctx, "contextError", text)),
        visible: true,
      };
    }
    if (ctx.contextPercent > 70) {
      return {
        content: withIcon(icons.context, color(ctx, "contextWarn", text)),
        visible: true,
      };
    }

    return {
      content: withIcon(icons.context, color(ctx, "context", text)),
      visible: true,
    };
  },
  renderCompact(ctx) {
    if (!ctx.contextWindow) {
      return { content: "", visible: false };
    }
    const text = `${ctx.contextPercent.toFixed(1)}%`;

    if (ctx.contextPercent > 90) {
      return { content: color(ctx, "contextError", text), visible: true };
    }
    if (ctx.contextPercent > 70) {
      return { content: color(ctx, "contextWarn", text), visible: true };
    }

    return { content: color(ctx, "context", text), visible: true };
  },
};

const contextTotalSegment: StatusBarSegment = {
  id: "context_total",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.contextWindow) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "context",
        withIcon(icons.context, formatTokens(ctx.contextWindow))
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    if (!ctx.contextWindow) {
      return { content: "", visible: false };
    }
    return {
      content: color(ctx, "context", formatTokens(ctx.contextWindow)),
      visible: true,
    };
  },
};

const timeSpentSegment: StatusBarSegment = {
  id: "time_spent",
  render(ctx) {
    const icons = getIcons();
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) {
      return { content: "", visible: false };
    }
    return {
      content: withIcon(icons.time, formatDuration(elapsed)),
      visible: true,
    };
  },
  renderCompact(ctx) {
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) {
      return { content: "", visible: false };
    }
    return { content: formatDuration(elapsed), visible: true };
  },
};

const timeSegment: StatusBarSegment = {
  id: "time",
  render(ctx) {
    const icons = getIcons();
    return { content: withIcon(icons.time, formatTime(ctx)), visible: true };
  },
  renderCompact(ctx) {
    return { content: formatTime(ctx), visible: true };
  },
};

const sessionSegment: StatusBarSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    return {
      content: withIcon(icons.session, ctx.sessionId?.slice(0, 8) || "new"),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return { content: ctx.sessionId?.slice(0, 8) || "new", visible: true };
  },
};

const hostnameSegment: StatusBarSegment = {
  id: "hostname",
  render() {
    const icons = getIcons();
    return {
      content: withIcon(icons.host, getShortHostname()),
      visible: true,
    };
  },
  renderCompact() {
    return { content: getShortHostname(), visible: true };
  },
};

const cacheReadSegment: StatusBarSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.usageStats.cacheRead) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "tokens",
        [icons.cache, icons.input, formatTokens(ctx.usageStats.cacheRead)]
          .filter(Boolean)
          .join(" ")
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return renderCompactToken(ctx, "CR", ctx.usageStats.cacheRead);
  },
};

const cacheWriteSegment: StatusBarSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.usageStats.cacheWrite) {
      return { content: "", visible: false };
    }
    return {
      content: color(
        ctx,
        "tokens",
        [icons.cache, icons.output, formatTokens(ctx.usageStats.cacheWrite)]
          .filter(Boolean)
          .join(" ")
      ),
      visible: true,
    };
  },
  renderCompact(ctx) {
    return renderCompactToken(ctx, "CW", ctx.usageStats.cacheWrite);
  },
};

function shouldRenderExtensionStatus(
  ctx: StatusBarContext,
  key: string,
  value: string
): boolean {
  if (ctx.dedicatedExtensionStatusKeys.has(key)) {
    return false;
  }

  if (!value || value.trimStart().startsWith("[")) {
    return false;
  }

  return visibleWidth(value) > 0;
}

function stripExtensionStatusSuffix(value: string): string {
  return value.replace(TRAILING_STATUS_DECORATION_PATTERN, "");
}

function getVisibleExtensionStatusParts(ctx: StatusBarContext): string[] {
  const parts: string[] = [];
  for (const [key, value] of ctx.extensionStatuses.entries()) {
    if (!shouldRenderExtensionStatus(ctx, key, value)) {
      continue;
    }

    const stripped = stripExtensionStatusSuffix(value);
    if (visibleWidth(stripped) > 0) {
      parts.push(stripped);
    }
  }
  return parts;
}

const extensionStatusesSegment: StatusBarSegment = {
  id: "extension_statuses",
  render(ctx) {
    if (!ctx.extensionStatuses.size) {
      return { content: "", visible: false };
    }

    const parts = getVisibleExtensionStatusParts(ctx);
    if (!parts.length) {
      return { content: "", visible: false };
    }
    return { content: parts.join(` ${SEP_DOT} `), visible: true };
  },
  renderCompact(ctx) {
    if (!ctx.extensionStatuses.size) {
      return { content: "", visible: false };
    }

    const parts = getVisibleExtensionStatusParts(ctx);
    if (!parts.length) {
      return { content: "", visible: false };
    }
    return { content: parts.join(" "), visible: true };
  },
};

const SEGMENTS: Record<StatusBarSegmentId, StatusBarSegment> = {
  pi: piSegment,
  model: modelSegment,
  path: pathSegment,
  git: gitSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cost: costSegment,
  context_pct: contextPctSegment,
  context_total: contextTotalSegment,
  time_spent: timeSpentSegment,
  time: timeSegment,
  session: sessionSegment,
  hostname: hostnameSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  thinking: thinkingSegment,
  caveman: cavemanSegment,
  extension_statuses: extensionStatusesSegment,
};

export function renderStatusBarSegment(
  id: StatusBarSegmentId,
  ctx: StatusBarContext,
  mode: StatusBarRenderMode = "normal"
): RenderedSegment {
  const segment = SEGMENTS[id];
  if (!segment) {
    return { content: "", visible: false };
  }
  if (mode === "compact" && segment.renderCompact) {
    return segment.renderCompact(ctx);
  }
  return segment.render(ctx);
}
