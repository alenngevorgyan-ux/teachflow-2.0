import React, { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import type { Language, MaterialAnswerKeyEntry, MaterialItem, MaterialParagraph } from '../../../shared/types';
import { translations } from '../../i18n/translations';

interface Props {
  lang: Language;
  paragraphs: MaterialParagraph[];
  items: MaterialItem[];
  answerKey: MaterialAnswerKeyEntry[];
  keyParagraphIds: string[];
  unassignedIds: string[];
  changedIds: Set<string>;
  attentionItemIds: Set<string>;
  selectedItemId: string | null;
  /** Incremented to ask the preview to scroll to (and focus) the selection. */
  focusRequest: number;
}

type Range = { start: number; end: number };

/** The parts of each paragraph that belong to the selected item (only those are highlighted). */
function selectionRanges(item: MaterialItem | undefined, key: MaterialAnswerKeyEntry | undefined, paragraphs: MaterialParagraph[]): Map<string, Range[]> {
  const out = new Map<string, Range[]>();
  if (!item) return out;
  const add = (pid: string, r: Range) => out.set(pid, [...(out.get(pid) ?? []), r]);
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  for (const pid of item.stemParagraphIds) {
    const span = item.stemSpans?.find((s) => s.paragraphId === pid);
    add(pid, span ? { start: span.start, end: span.end } : { start: 0, end: byId.get(pid)?.text.length ?? 0 });
  }
  for (const o of item.options) add(o.paragraphId, { start: o.start, end: o.end });
  if (key?.span) add(key.span.paragraphId, { start: key.span.start, end: key.span.end });
  return out;
}

function renderMarked(text: string, ranges: Range[] | undefined): React.ReactNode {
  if (!ranges?.length) return text;
  const merged = [...ranges].sort((a, b) => a.start - b.start).reduce<Range[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else acc.push({ ...r });
    return acc;
  }, []);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach((r, i) => {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(<mark key={i}>{text.slice(r.start, r.end)}</mark>);
    pos = r.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function DocumentPreview(p: Props) {
  const m = translations[p.lang].materialReview;
  const refs = useRef(new Map<string, HTMLDivElement>());
  const itemOf = new Map<string, MaterialItem>();
  for (const it of p.items) for (const pid of [...it.stemParagraphIds, ...it.options.map((o) => o.paragraphId)]) itemOf.set(pid, it);
  const selected = p.items.find((i) => i.id === p.selectedItemId);
  const ranges = selectionRanges(selected, p.answerKey.find((k) => k.itemId === p.selectedItemId), p.paragraphs);
  const keySet = new Set(p.keyParagraphIds);
  const unassigned = new Set(p.unassignedIds);

  useEffect(() => {
    if (!selected || p.focusRequest === 0) return;
    const first = refs.current.get(selected.stemParagraphIds[0]);
    first?.scrollIntoView({ block: 'center' });
    first?.focus({ preventScroll: true });
  }, [p.focusRequest]);

  const lockText = (reasons: string[]) =>
    reasons
      .map((r) => {
        const key = `lock_${r.startsWith('unknown:') ? 'unknown' : r}` as keyof typeof m;
        return (m[key] as string | undefined) ?? r;
      })
      .join(', ');

  const block = (para: MaterialParagraph) => {
    if (para.text.trim() === '') return null;
    const item = itemOf.get(para.id);
    const active = ranges.has(para.id);
    const note = [
      keySet.has(para.id) ? m.keyBlock : null,
      unassigned.has(para.id) ? m.unassigned : null,
      p.changedIds.has(para.id) ? m.changed : null,
      !para.editable ? `${m.locked}: ${lockText(para.lockReasons)}` : null,
    ].filter(Boolean);
    return (
      <div
        key={para.id}
        ref={(n) => {
          if (n) refs.current.set(para.id, n);
          else refs.current.delete(para.id);
        }}
        tabIndex={active ? -1 : undefined}
        className="tf-block"
        data-active={active}
        data-kind={keySet.has(para.id) ? 'key' : undefined}
        data-locked={!para.editable}
        data-attention={item ? p.attentionItemIds.has(item.id) : undefined}
        data-unassigned={unassigned.has(para.id)}
        id={`para-${para.id}`}
      >
        {para.label && <span className="tf-label">{para.label}</span>}
        {renderMarked(para.text, ranges.get(para.id))}
        {!para.editable && <Lock aria-hidden style={{ inlineSize: 14, blockSize: 14, marginInlineStart: 6, verticalAlign: '-2px' }} />}
        {note.length > 0 && <span className="tf-block-note">{note.join(' · ')}</span>}
      </div>
    );
  };

  // Group table paragraphs into their tables so the preview keeps rows and cells.
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < p.paragraphs.length) {
    const para = p.paragraphs[i];
    if (para.location === 'table' && para.table) {
      const t = para.table.table;
      const cells = new Map<string, MaterialParagraph[]>();
      let rows = 0;
      let cols = 0;
      while (i < p.paragraphs.length && p.paragraphs[i].location === 'table' && p.paragraphs[i].table?.table === t) {
        const c = p.paragraphs[i].table!;
        const k = `${c.row}:${c.cell}`;
        cells.set(k, [...(cells.get(k) ?? []), p.paragraphs[i]]);
        rows = Math.max(rows, c.row + 1);
        cols = Math.max(cols, c.cell + 1);
        i++;
      }
      out.push(
        <div key={`table-${t}-${i}`} className="tf-table-block" role="region" aria-label={`${m.tableCell} ${t + 1}`} tabIndex={0}>
          <table>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c}>{(cells.get(`${r}:${c}`) ?? []).map(block)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    out.push(block(para));
    i++;
  }
  return <>{out}</>;
}
