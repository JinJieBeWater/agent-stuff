import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  Marked,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  type Tokens,
  visibleWidth,
} from "@earendil-works/pi-tui";

const parser = new Marked();

function codeSpan(line: string): string {
  const content = line || "\u00a0";
  const longestRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${padding}${content}${padding}${fence}`;
}

function renderTable(
  table: Tokens.Table,
  width: number,
  definitions: string,
  isStreaming: boolean,
  isLastToken: boolean,
): string {
  const columns = table.header.length;
  if (columns === 0 || (table.rows.length === 0 && !isStreaming)) return table.raw;

  const rows = [table.header, ...table.rows];
  // oxlint-disable-next-line no-control-regex -- Reject control-bearing cells before rendering.
  if (rows.some((row) => row.some((cell) => /[\u0000-\u001f\u007f-\u009f]/.test(cell.text))))
    return table.raw;
  const lines = table.raw.replace(/\n+$/, "").split("\n");
  // Marked pads missing cells and discards extra ones; validate its raw rows before trusting them.
  if (lines.length !== rows.length + 1 || table.raw.includes("\\|")) return table.raw;
  for (const [i, line] of lines.entries()) {
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    // Pi trims terminal newlines; only the streaming message's final row may lack cells.
    const partial = isStreaming && isLastToken && i === lines.length - 1 && i > 1;
    if (cells.length > columns || (cells.length < columns && !partial)) return table.raw;
    if (i === 1) continue;
    const row = rows[i === 0 ? 0 : i - 1]!;
    if (row.length !== columns || row.some((cell, j) => cell.text !== (cells[j]?.trim() ?? "")))
      return table.raw;
  }

  const theme = getMarkdownTheme();
  // Removing the outer frame and using two-space gutters returns columns + 3 cells to content.
  const layout = new Markdown(`${table.raw}\n\n${definitions}`, 0, 0, theme).render(
    width + columns + 3,
  );
  const top = stripTerminalSequences(layout[0] ?? "").trimEnd();
  // shortcut: recognize Pi 1.4's frame; retain native rendering if its layout changes.
  if (!/^┌─+(?:┬─+)*┐$/.test(top)) return table.raw;
  const boundaries = Array.from(top.matchAll(/[┌┬┐]/g), (match) => match.index!);
  if (boundaries.length !== columns + 1) return table.raw;
  const widths = boundaries.slice(0, -1).map((start, i) => boundaries[i + 1]! - start - 3);
  const output: string[] = [];
  let headerRule = false;
  for (const line of layout.slice(1)) {
    const plain = stripTerminalSequences(line).trimEnd();
    if (!plain || /^└─+(?:┴─+)*┘$/.test(plain)) continue;
    if (/^├─+(?:┼─+)*┤$/.test(plain)) {
      const rule = headerRule ? "─" : "━";
      output.push(theme.codeBlockBorder(widths.map((width) => rule.repeat(width)).join("  ")));
      headerRule = true;
      continue;
    }
    if (boundaries.some((column) => stripTerminalSequences(sliceByColumn(line, column, 1)) !== "│"))
      return table.raw;
    // Consume boundary-closing ANSI along with the native right padding, then drop that space.
    const cells = widths.map((width, i) => {
      const cell = sliceByColumn(line, boundaries[i]! + 2, width + 1).replace(/ $/, "");
      const padding = Math.max(
        0,
        width - visibleWidth(stripTerminalSequences(cell).replace(/ +$/, "")),
      );
      const left =
        table.align[i] === "right"
          ? padding
          : table.align[i] === "center"
            ? Math.floor(padding / 2)
            : 0;
      // Pi 1.4 lays out all cells left-aligned; move only padding and keep ANSI/link closures.
      return left ? " ".repeat(left) + truncateToWidth(cell, width - left, "") : cell;
    });
    output.push(cells.map((cell) => theme.codeBlock(cell)).join("  "));
  }
  if (!headerRule) return table.raw;
  return `\n\n${output.map(codeSpan).join("  \n")}\n\n`;
}

function renderListTables(
  list: Tokens.List,
  width: number,
  definitions: string,
  streamingTail: boolean,
  depth = 0,
): string {
  if (list.items.map((item) => item.raw).join("") !== list.raw) return list.raw;
  return list.items
    .map((item, i) => {
      if (!item.tokens.some((t) => t.type === "table" || t.type === "list")) return item.raw;
      const marker = /^ {0,3}(?:[-+*]|\d{1,9}[.)]) +/.exec(item.raw)?.[0];
      if (!marker) return item.raw;
      const indent = " ".repeat(marker.length);
      const wrap = (body: string) => marker + body.replace(/\n(?=[^\n])/g, "\n" + indent);
      const original = wrap(item.tokens.map((t) => t.raw).join(""));
      const suffix = item.raw.slice(original.length);
      // Marked removes list prefixes. Only reapply them if this reproduces the original source.
      if (!item.raw.startsWith(original) || /[^\n]/.test(suffix)) return item.raw;

      // Pi indents nested lists by four columns per level and renumbers ordered markers.
      const bulletWidth = list.ordered ? String(Number(list.start) + i).length + 2 : 2;
      const innerWidth = width - depth * 4 - bulletWidth - (item.task ? 4 : 0);
      const body = item.tokens
        .map((token, j) => {
          const tail = streamingTail && i === list.items.length - 1 && j === item.tokens.length - 1;
          if (token.type === "list")
            return renderListTables(token as Tokens.List, width, definitions, tail, depth + 1);
          if (token.type !== "table" || innerWidth < 1) return token.raw;
          const table = renderTable(
            token as Tokens.Table,
            innerWidth,
            definitions,
            streamingTail,
            tail,
          );
          if (table === token.raw) return token.raw;
          // Keep the marker attached and preserve tight lists and adjacent block boundaries.
          if (item.tokens[j - 1]?.raw.endsWith("\\\n")) return token.raw;
          return table.trim() + (token.raw.match(/\n+$/)?.[0] ?? "");
        })
        .join("");
      return wrap(body) + suffix;
    })
    .join("");
}

export default function borderlessTables(pi: ExtensionAPI) {
  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant" || !markdown.includes("|")) return markdown;
    if (!Number.isSafeInteger(context.availableWidth) || context.availableWidth < 1)
      return markdown;
    const tokens = parser.lexer(markdown);
    // Lexer normalization (e.g. CRLF) must never rewrite unrelated source.
    if (tokens.map((token) => token.raw).join("") !== markdown) return markdown;
    const definitions: string[] = [];
    parser.walkTokens(tokens, (token) => {
      if (token.type === "def") definitions.push(token.raw);
    });
    const refs = definitions.join("\n");
    return tokens
      .map((token, index) => {
        const last = index === tokens.length - 1;
        if (token.type === "list")
          return renderListTables(
            token as Tokens.List,
            context.availableWidth,
            refs,
            context.isStreaming && last,
          );
        if (token.type === "table")
          return renderTable(
            token as Tokens.Table,
            context.availableWidth,
            refs,
            context.isStreaming,
            last,
          );
        return token.raw;
      })
      .join("");
  });
}
