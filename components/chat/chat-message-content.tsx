import { createElement, type ReactNode } from "react";

interface ChatMessageContentProps {
  content: string;
  className?: string;
  streaming?: boolean;
}

export function ChatMessageContent({
  content,
  className,
  streaming = false,
}: ChatMessageContentProps) {
  return <div className={className}>{renderBlocks(content, streaming)}</div>;
}

function renderBlocks(content: string, streaming: boolean): ReactNode[] {
  const lines = content.split(/\r?\n/u);
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < lines.length) {
    const line = lines[cursor];

    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], streaming, key++));
      cursor += 1;
      continue;
    }

    if (isListLine(line)) {
      const items: string[] = [];
      while (cursor < lines.length && isListLine(lines[cursor])) {
        items.push(lines[cursor].trim().replace(/^[-*]\s+/u, ""));
        cursor += 1;
      }
      blocks.push(
        <ul key={key++} className="my-3 list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{renderEmphasis(item, streaming)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      cursor < lines.length &&
      lines[cursor].trim().length > 0 &&
      !/^(#{1,6})\s+.+$/u.test(lines[cursor].trim()) &&
      !isListLine(lines[cursor])
    ) {
      paragraph.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push(
      <p key={key++} className="my-3 whitespace-pre-wrap">
        {renderEmphasis(paragraph.join("\n"), streaming)}
      </p>,
    );
  }

  return blocks;
}

function renderHeading(
  level: number,
  content: string,
  streaming: boolean,
  key: number,
): ReactNode {
  const className = "my-4 font-display text-base font-semibold leading-7 text-ink";
  return createElement(
    `h${Math.min(Math.max(level, 1), 6)}`,
    { key, className },
    renderEmphasis(content, streaming),
  );
}

function isListLine(line: string): boolean {
  return /^[-*]\s+.+$/u.test(line.trim());
}

function renderEmphasis(content: string, streaming: boolean): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < content.length) {
    const opening = content.indexOf("**", cursor);
    if (opening === -1) {
      parts.push(content.slice(cursor));
      break;
    }

    if (opening > cursor) parts.push(content.slice(cursor, opening));

    const closing = content.indexOf("**", opening + 2);
    if (closing === -1) {
      if (streaming) {
        parts.push(
          <strong key={key++} className="font-semibold text-ink">
            {content.slice(opening + 2)}
          </strong>,
        );
      } else {
        parts.push(content.slice(opening));
      }
      break;
    }

    parts.push(
      <strong key={key++} className="font-semibold text-ink">
        {content.slice(opening + 2, closing)}
      </strong>,
    );
    cursor = closing + 2;
  }

  return parts;
}
