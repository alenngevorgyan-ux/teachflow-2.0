# Design reference notes

## Reference pass (time-boxed, 2026-09-24 ≈ 05:20 local)

The brief asked for 4–6 *inspected product flows*. None of the suggested libraries showed flow content without an account or a paid plan, so **no product flow was inspected**. Homepages are not evidence and are not used as such.

| Site | What was reachable | Status |
|---|---|---|
| https://nicelydone.club/ | Category list (file upload, import/export, onboarding…); screens require an account | Unavailable (login) |
| https://pageflows.com/ | Flow category names ("Uploading & Downloading", "Importing & Exporting"); steps require a paid trial | Unavailable (paywall) |
| https://www.saasframe.io/ | Pattern category counts; `/patterns/empty-state` shows company names (Stripe, Attio, Supabase…) but the content is "Upgrade to SaaSFrame Pro" | Unavailable (paywall) |
| https://mobbin.com/ | Marketing page only; library requires an account | Unavailable (login) |
| figma.com/community, godly.website | Not tried: the four above already exhausted the time box, and neither was needed to decide the direction | Not inspected |

Nothing was bought and no observations are invented. The design direction below comes from the brief (§5) and the supplied `design/` reference (`teachflow.css`, `ReviewWorkbench.tsx`, `hy.ts`), which were adapted to the existing React + Tailwind architecture.

## Direction chosen

A calm Armenian teaching workspace: warm near-white canvas (`#f5f6f3`), white document surface, graphite ink (`#202b29`), one deep teal action colour (`#17624e`), quiet borders, restrained status colours (warning `#815014`, error `#a33232`). The document is the visual centre; findings sit beside it.

## Decisions

- **One system, not a second app.** Tokens live in `src/styles/teachflow.css`. Tailwind's `indigo` and `gray` scales are remapped to the same palette in `src/index.css` (`@theme`), so every existing screen changed with no rewrite. `gray-400/500` are dark enough for text.
- **Contrast is measured, not eyeballed.** ink/bg 13.4, muted/white 6.0, muted/bg 5.5, brand/white 7.3, warning 6.2, error 6.1, remapped gray-400 on white/bg 5.3/4.9, control border 3.6, focus 5.9 (WCAG ratios; script in the session, values recorded in the CSS header).
- **Armenian typography.** Noto Sans Armenian + Noto Sans are bundled locally via `@fontsource` (OFL-1.1, `font-display: swap`). The Armenian subset covers U+0530–058F (incl. `և`) and FB13–FB17. The Google Fonts request was removed. 16px UI, 18px document text at line height 1.8. `html lang` follows the language and `dir="ltr"`. Armenian is never tracked or set in capitals (a CSS rule, and the demo badges were rewritten in normal case).
- **Shell.** A 236px left navigation grouped Main / Other tools / Administration; existing role rules unchanged. The context bar folds into one summary line below 900px. Role and language sit in the sidebar footer (the role switch is a demo control without authentication). A real drawer below 900px (Escape closes it and focus returns). Skip link.
- **Review workbench.** Header with file name, save state, revision, source summary and a draft/final badge; exactly one primary next action derived from state; stage bar Upload → Structure → Check → Review → Export derived from real state (not a locked wizard). Document in the centre, 320–372px findings panel on the right, switch between them below 900px. Only the selected question's own spans are highlighted (question text, options, key entry).
- **Honest counts, no scores.** Unresolved / not evaluated / awaiting re-check are counts. There is no reliability percentage. The default "needs attention" filter always offers the not-evaluated count as a one-click filter.
- **Status never by colour alone.** Every badge has an icon and text.
- **Buttons say what they do.** "Ընդունել ուղղումը", "Մերժել առաջարկը" (with the note that declining is not certifying), "Ներբեռնել բնօրինակը". Downloads are disabled while a write is in flight. Undo is separated from accept and download.
- **Rejected.** Gradients, glass panels, emoji or sparkle branding, KPI cards, fake activity and invented statistics on Home, uppercase navigation, a "reliability %", bulk "accept all".

## Pending

- Linguistic QA of the Armenian UI strings by a fluent reviewer (not done; the strings are the author's own).
- A real designer's review of the palette and spacing on real teacher documents.
