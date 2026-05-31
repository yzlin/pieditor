const TOP_LEVEL_REGEX_1 = /^\/([^\s:]+)(.*)/s;
export function remapCommand(
  text: string,
  commandRemap: Record<string, string>
): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) {
    return text;
  }

  const match = trimmed.match(TOP_LEVEL_REGEX_1);
  if (!match) {
    return text;
  }

  const cmd = match[1];
  const rest = match[2] ?? "";
  if (!cmd) {
    return text;
  }

  const target = commandRemap[cmd];
  return target ? `/${target}${rest}` : text;
}
