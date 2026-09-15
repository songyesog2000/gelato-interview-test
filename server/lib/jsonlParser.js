// Parses a Claude Code CLI session JSONL file into "records": one record per
// real user instruction, carrying every assistant message / tool call /
// tool result that happened until the next real user instruction.
//
// Session files interleave two things that both show up as `type: "user"`
// entries:
//   1. text actually typed by the human ("real" input, starts a new record)
//   2. tool_result blocks that Claude Code feeds back to the model after a
//      tool call — these are not new input, they belong to the current record.
// We tell them apart by inspecting `message.content`: a plain string, or an
// array of blocks with no `tool_result` block, means a human typed it.
//
// Limitation: this parser targets the Claude Code CLI format described in
// the task's own trajectory-extraction section. Codex CLI rollout files use
// a different event schema; lines that don't match the expected shape are
// still preserved (as raw, unclassified events in a record) instead of
// being dropped, so nothing is silently lost, but they won't be split into
// separate records the way Claude Code turns are.

function isRealUserInput(entry) {
  if (!entry || entry.type !== 'user') return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    if (content.length === 0) return false;
    return content.every((block) => block && block.type !== 'tool_result');
  }
  return false;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n\n');
  }
  return '';
}

// Flattens one raw JSONL entry into zero or more display-friendly items.
// `rawIndex` lets the UI jump back to the original JSON for that line.
function flattenEntry(entry, rawIndex) {
  const items = [];
  const type = entry.type;

  if (type === 'user') {
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') {
      items.push({ rawIndex, kind: 'user_input', text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'tool_result') {
          items.push({
            rawIndex,
            kind: 'tool_result',
            toolUseId: block.tool_use_id || null,
            isError: !!block.is_error,
            text: extractText(block.content) || (typeof block.content === 'string' ? block.content : JSON.stringify(block.content)),
          });
        } else if (block.type === 'text') {
          items.push({ rawIndex, kind: 'user_input', text: block.text });
        } else {
          items.push({ rawIndex, kind: 'user_other', text: JSON.stringify(block) });
        }
      }
    }
    return items;
  }

  if (type === 'assistant') {
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') {
      items.push({ rawIndex, kind: 'assistant_text', text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'text') {
          items.push({ rawIndex, kind: 'assistant_text', text: block.text });
        } else if (block.type === 'tool_use') {
          items.push({
            rawIndex,
            kind: 'tool_use',
            toolName: block.name,
            toolUseId: block.id || null,
            input: block.input,
          });
        } else {
          items.push({ rawIndex, kind: 'assistant_other', text: JSON.stringify(block) });
        }
      }
    }
    return items;
  }

  if (type === 'system') {
    items.push({ rawIndex, kind: 'system', text: entry.content || extractText(entry.message && entry.message.content) });
    return items;
  }

  // Anything else (Codex-style events, summaries, unknown future types):
  // keep it visible rather than dropping it.
  items.push({ rawIndex, kind: 'unclassified', text: JSON.stringify(entry).slice(0, 2000) });
  return items;
}

function parseJsonlTrajectory(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rawEntries = [];
  const parseErrors = [];

  lines.forEach((line, i) => {
    try {
      rawEntries.push(JSON.parse(line));
    } catch (err) {
      parseErrors.push({ line: i + 1, message: err.message, raw: line.slice(0, 200) });
      rawEntries.push(null); // keep index alignment with line numbers
    }
  });

  const records = [];
  let preamble = { seq: 0, preamble: true, timestamp: null, inputText: '', items: [] };
  let current = null;

  rawEntries.forEach((entry, rawIndex) => {
    if (entry === null) return; // skip unparsable lines, already reported above
    if (isRealUserInput(entry)) {
      current = {
        seq: records.length + 1,
        timestamp: entry.timestamp || null,
        inputText: extractText(entry.message.content),
        items: flattenEntry(entry, rawIndex),
      };
      records.push(current);
      return;
    }
    const target = current || preamble;
    target.items.push(...flattenEntry(entry, rawIndex));
  });

  if (preamble.items.length > 0) {
    records.unshift(preamble);
  }

  return {
    totalLines: lines.length,
    parseErrors,
    recordCount: records.length,
    records,
    rawEntries,
  };
}

module.exports = { parseJsonlTrajectory, isRealUserInput, extractText };
