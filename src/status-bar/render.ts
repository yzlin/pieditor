import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { StatusBarRuntimeConfig } from "../config/index.js";
import { getGitStatus } from "./git.js";
import { resolveStatusBarPresetDef } from "./presets.js";
import { renderStatusBarSegment } from "./segments.js";
import { fg, getDefaultColors } from "./theme.js";
import type {
  ColorScheme,
  StatusBarContext,
  StatusBarPresetDef,
  StatusBarRenderMode,
  StatusBarSegmentId,
  UsageStats,
} from "./types.js";

const AMP_BOTTOM_SEGMENTS = new Set<StatusBarSegmentId>(["path", "git"]);

export interface AmpStatusLayout {
  topLeftContent: string;
  topRightContent: string;
  bottomContent: string;
}

interface ComputedStatusRow {
  leftContent: string;
  rightContent: string;
  content: string;
  width: number;
}

type StatusRowRenderer = (
  leftSegments: string[],
  rightSegments: string[],
  mode: StatusBarRenderMode
) => ComputedStatusRow;

const EMPTY_STATUS_ROW: ComputedStatusRow = {
  leftContent: "",
  rightContent: "",
  content: "",
  width: 0,
};

function renderSegmentContent(
  segId: StatusBarSegmentId,
  ctx: StatusBarContext,
  mode: StatusBarRenderMode = "normal"
): string | null {
  const rendered = renderStatusBarSegment(segId, ctx, mode);
  return rendered.visible && rendered.content ? rendered.content : null;
}

function buildContentFromParts(
  parts: string[],
  presetDef: StatusBarPresetDef,
  theme: Theme,
  colors: ColorScheme,
  mode: StatusBarRenderMode = "normal"
): string {
  if (!parts.length) {
    return "";
  }
  const separator = mode === "compact" ? " | " : presetDef.separator;
  const coloredSeparator = fg(theme, "separator", separator, colors);
  return ` ${parts.join(coloredSeparator)} `;
}

function fitToWidth(content: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const actualWidth = visibleWidth(content);
  if (actualWidth === width) {
    return content;
  }
  if (actualWidth > width) {
    return truncateToWidth(content, width);
  }
  return content + " ".repeat(width - actualWidth);
}

function renderVisibleSegments(
  segmentIds: StatusBarSegmentId[],
  ctx: StatusBarContext,
  mode: StatusBarRenderMode = "normal"
): string[] {
  return segmentIds.flatMap((segId) => {
    const content = renderSegmentContent(segId, ctx, mode);
    return content ? [content] : [];
  });
}

function renderStatusBarContent(
  segmentIds: StatusBarSegmentId[],
  presetDef: StatusBarPresetDef,
  ctx: StatusBarContext,
  mode: StatusBarRenderMode = "normal"
): string {
  return buildContentFromParts(
    renderVisibleSegments(segmentIds, ctx, mode),
    presetDef,
    ctx.theme,
    ctx.colors,
    mode
  );
}

function computeFittingRow(options: {
  ctx: StatusBarContext;
  leftSegmentIds: StatusBarSegmentId[];
  rightSegmentIds: StatusBarSegmentId[];
  renderRow: StatusRowRenderer;
  width: number;
}): ComputedStatusRow {
  const { ctx, leftSegmentIds, rightSegmentIds, renderRow, width } = options;
  const normalLeftSegments = renderVisibleSegments(leftSegmentIds, ctx);
  const normalRightSegments = renderVisibleSegments(rightSegmentIds, ctx);

  if (!(normalLeftSegments.length || normalRightSegments.length)) {
    return EMPTY_STATUS_ROW;
  }

  const normalRow = renderRow(normalLeftSegments, normalRightSegments, "normal");
  if (normalRow.width <= width) {
    return normalRow;
  }

  const compactLeftSegments = renderVisibleSegments(
    leftSegmentIds,
    ctx,
    "compact"
  );
  const compactRightSegments = renderVisibleSegments(
    rightSegmentIds,
    ctx,
    "compact"
  );

  let left = compactLeftSegments;
  let right = compactRightSegments;
  let row = renderRow(left, right, "compact");

  while (row.width > width) {
    if (right.length > 0) {
      right = right.slice(0, -1);
      row = renderRow(left, right, "compact");
      continue;
    }

    if (left.length > 0) {
      left = left.slice(0, -1);
      row = renderRow(left, right, "compact");
      continue;
    }

    break;
  }

  return row;
}

function computeSplitRowContent(
  ctx: StatusBarContext,
  presetDef: StatusBarPresetDef,
  leftSegmentIds: StatusBarSegmentId[],
  rightSegmentIds: StatusBarSegmentId[],
  width: number
): ComputedStatusRow {
  const getSide = (segments: string[], mode: StatusBarRenderMode) => {
    const content = buildContentFromParts(
      segments,
      presetDef,
      ctx.theme,
      ctx.colors,
      mode
    );

    return {
      content,
      width: visibleWidth(content),
    };
  };

  const renderRow: StatusRowRenderer = (left, right, mode) => {
    const leftSide = getSide(left, mode);
    const rightSide = getSide(right, mode);

    if (!(leftSide.content || rightSide.content)) {
      return EMPTY_STATUS_ROW;
    }

    if (!leftSide.content) {
      const content = `${" ".repeat(Math.max(width - rightSide.width, 0))}${rightSide.content}`;
      return {
        leftContent: "",
        rightContent: rightSide.content,
        content,
        width: visibleWidth(content),
      };
    }

    if (!rightSide.content) {
      return {
        leftContent: leftSide.content,
        rightContent: "",
        content: leftSide.content,
        width: leftSide.width,
      };
    }

    const gapWidth = Math.max(width - leftSide.width - rightSide.width, 1);
    const content = `${leftSide.content}${" ".repeat(gapWidth)}${rightSide.content}`;
    return {
      leftContent: leftSide.content,
      rightContent: rightSide.content,
      content,
      width: visibleWidth(content),
    };
  };

  return computeFittingRow({
    ctx,
    leftSegmentIds,
    rightSegmentIds,
    renderRow,
    width,
  });
}

function computeRowContent(
  ctx: StatusBarContext,
  presetDef: StatusBarPresetDef,
  leftSegmentIds: StatusBarSegmentId[],
  rightSegmentIds: StatusBarSegmentId[],
  width: number
): string {
  return computeSplitRowContent(
    ctx,
    presetDef,
    leftSegmentIds,
    rightSegmentIds,
    width
  ).content;
}

function computeUnpaddedRowContent(
  ctx: StatusBarContext,
  presetDef: StatusBarPresetDef,
  leftSegmentIds: StatusBarSegmentId[],
  rightSegmentIds: StatusBarSegmentId[],
  width: number
): string {
  const renderRow: StatusRowRenderer = (left, right, mode) => {
    const content = buildContentFromParts(
      [...left, ...right],
      presetDef,
      ctx.theme,
      ctx.colors,
      mode
    );

    return {
      leftContent: "",
      rightContent: "",
      content,
      width: visibleWidth(content),
    };
  };

  return computeFittingRow({
    ctx,
    leftSegmentIds,
    rightSegmentIds,
    renderRow,
    width,
  }).content;
}

function collectUsageStats(ctx: ExtensionContext): {
  usageStats: UsageStats;
  thinkingLevel: string;
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let thinkingLevel = "off";

  const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
  for (const entry of sessionEvents) {
    if (entry.type === "thinking_level_change" && entry.thinkingLevel) {
      thinkingLevel = entry.thinkingLevel;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const message = entry.message as AssistantMessage;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      continue;
    }

    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    cacheWrite += message.usage.cacheWrite;
    cost += message.usage.cost.total;
  }

  return {
    usageStats: { input, output, cacheRead, cacheWrite, cost },
    thinkingLevel,
  };
}

export function buildStatusBarContext(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  presetDef: StatusBarPresetDef,
  sessionStartTime: number,
  theme: Theme
): StatusBarContext {
  const colors: ColorScheme = presetDef.colors ?? getDefaultColors();
  const { usageStats, thinkingLevel } = collectUsageStats(ctx);
  const contextUsage = ctx.getContextUsage?.();
  const contextPercent = contextUsage?.percent ?? 0;
  const model = ctx.model;
  const contextWindow =
    contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
  const providerBranch = footerData?.getGitBranch() ?? null;
  const modelRegistry = ctx.modelRegistry as {
    isUsingOAuth?: (model: NonNullable<ExtensionContext["model"]>) => boolean;
  };
  const usingSubscription = model
    ? (modelRegistry.isUsingOAuth?.(model) ?? false)
    : false;

  const hasDedicatedCavemanSegment =
    presetDef.leftSegments.includes("caveman") ||
    presetDef.rightSegments.includes("caveman");
  const hasModelSegment =
    presetDef.leftSegments.includes("model") ||
    presetDef.rightSegments.includes("model");
  const dedicatedExtensionStatusKeys = new Set([
    ...(hasDedicatedCavemanSegment ? ["caveman"] : []),
    ...(hasModelSegment ? ["fast"] : []),
  ]);

  return {
    model,
    thinkingLevel,
    sessionId: ctx.sessionManager?.getSessionId?.(),
    usageStats,
    contextPercent,
    contextWindow,
    usingSubscription,
    sessionStartTime,
    git: getGitStatus(providerBranch),
    extensionStatuses: footerData?.getExtensionStatuses() ?? new Map(),
    dedicatedExtensionStatusKeys,
    options: presetDef.segmentOptions ?? {},
    theme,
    colors,
  };
}

export function buildAmpStatusLayout(options: {
  ctx: ExtensionContext | null;
  footerData: ReadonlyFooterDataProvider | null;
  config: StatusBarRuntimeConfig;
  sessionStartTime: number;
  theme: Theme;
  width?: number;
}): AmpStatusLayout {
  const { ctx, footerData, config, sessionStartTime, theme, width } = options;
  if (!(config.enabled && ctx)) {
    return { topLeftContent: "", topRightContent: "", bottomContent: "" };
  }

  const presetDef = resolveStatusBarPresetDef(config);
  const statusBarContext = buildStatusBarContext(
    ctx,
    footerData,
    presetDef,
    sessionStartTime,
    theme
  );
  const topLeftSegmentIds = presetDef.leftSegments.filter(
    (segId) => !AMP_BOTTOM_SEGMENTS.has(segId)
  );
  const topRightSegmentIds = presetDef.rightSegments.filter(
    (segId) => !AMP_BOTTOM_SEGMENTS.has(segId)
  );
  const bottomLeftSegmentIds = presetDef.leftSegments.filter((segId) =>
    AMP_BOTTOM_SEGMENTS.has(segId)
  );
  const bottomRightSegmentIds = presetDef.rightSegments.filter((segId) =>
    AMP_BOTTOM_SEGMENTS.has(segId)
  );
  const contentWidth = typeof width === "number" ? Math.max(width - 2, 0) : null;

  if (contentWidth !== null) {
    const topContent = computeSplitRowContent(
      statusBarContext,
      presetDef,
      topLeftSegmentIds,
      topRightSegmentIds,
      contentWidth
    );
    return {
      topLeftContent: topContent.leftContent,
      topRightContent: topContent.rightContent,
      bottomContent: computeUnpaddedRowContent(
        statusBarContext,
        presetDef,
        bottomLeftSegmentIds,
        bottomRightSegmentIds,
        contentWidth
      ),
    };
  }

  return {
    topLeftContent: renderStatusBarContent(
      topLeftSegmentIds,
      presetDef,
      statusBarContext
    ),
    topRightContent: renderStatusBarContent(
      topRightSegmentIds,
      presetDef,
      statusBarContext
    ),
    bottomContent: renderStatusBarContent(
      [...bottomLeftSegmentIds, ...bottomRightSegmentIds],
      presetDef,
      statusBarContext
    ),
  };
}

export function renderStatusBarLine(options: {
  width: number;
  ctx: ExtensionContext;
  footerData: ReadonlyFooterDataProvider | null;
  config: StatusBarRuntimeConfig;
  sessionStartTime: number;
  theme: Theme;
}): string {
  const { width, ctx, footerData, config, sessionStartTime, theme } = options;
  const presetDef = resolveStatusBarPresetDef(config);
  const statusBarContext = buildStatusBarContext(
    ctx,
    footerData,
    presetDef,
    sessionStartTime,
    theme
  );
  const content = computeRowContent(
    statusBarContext,
    presetDef,
    presetDef.leftSegments,
    presetDef.rightSegments,
    width
  );

  if (!content) {
    return theme.fg("borderMuted", "─".repeat(width));
  }

  return fitToWidth(content, width);
}
