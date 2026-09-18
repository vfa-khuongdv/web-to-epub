---
name: "Web → EPUB for Kindle"
description: "Desktop library — an archivist's tool for turning web novels into Kindle EPUBs."
colors:
  chrome: "#ececec"
  chrome-2: "#e2e2e2"
  raised: "#f7f7f7"
  content: "#ffffff"
  sunken: "#e6e6e6"
  segment-on: "#ffffff"
  row-hover: "#f2f2f2"
  ink: "#1c1c1c"
  ink-2: "#4a4a4a"
  ink-3: "#6f6f6f"
  rule: "#d4d4d4"
  rule-2: "#b9b9b9"
  select: "#3b6fb6"
  select-deep: "#2f5c99"
  select-soft: "#e8f0fa"
  on-select: "#ffffff"
  error: "#b3261e"
  error-soft: "#fbecec"
  error-rule: "#e3b2af"
  btn: "#f2f2f2"
  btn-hover: "#e8e8e8"
  btn-rule: "#b9b9b9"
typography:
  display:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "52px"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  display-compact:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  display-denominator:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 650
    letterSpacing: "0.07em"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.45
  figure:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
rounded:
  tool: "3px"
  micro: "2px"
  scrollbar: "6px"
spacing:
  hairline: "1px"
  cell-x: "10px"
  cell-y: "4px"
  pane-pad: "14px"
  section-gap: "13px"
  cmdbar: "44px"
  row: "30px"
  pane-head: "40px"
  jobs-idle: "36px"
  jobs-active: "58px"
  log-max: "190px"
components:
  command-bar:
    backgroundColor: "{colors.chrome}"
    height: "44px"
    padding: "0 14px"
  pane-head:
    backgroundColor: "{colors.raised}"
    height: "40px"
    padding: "6px 12px"
  segmented:
    backgroundColor: "{colors.sunken}"
    rounded: "{rounded.tool}"
    padding: "2px"
  segment:
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.micro}"
    padding: "4px 12px"
  segment-selected:
    backgroundColor: "{colors.segment-on}"
    textColor: "{colors.ink}"
  button:
    backgroundColor: "{colors.btn}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.tool}"
    padding: "5px 11px"
  button-hover:
    backgroundColor: "{colors.btn-hover}"
  button-pressed:
    backgroundColor: "{colors.chrome-2}"
  button-primary:
    backgroundColor: "{colors.select}"
    textColor: "{colors.on-select}"
    typography: "{typography.control}"
    rounded: "{rounded.tool}"
    padding: "5px 11px"
  button-primary-hover:
    backgroundColor: "{colors.select-deep}"
  button-primary-pressed:
    backgroundColor: "{colors.select-deep}"
  button-danger:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    typography: "{typography.control}"
    rounded: "{rounded.tool}"
    padding: "5px 11px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.tool}"
    padding: "5px 11px"
  button-quiet-hover:
    backgroundColor: "{colors.btn-hover}"
    textColor: "{colors.ink}"
  button-tiny:
    padding: "2px 8px"
  chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    typography: "{typography.micro}"
    rounded: "{rounded.micro}"
    padding: "1px 7px"
  chip-running:
    backgroundColor: "{colors.select-soft}"
    textColor: "{colors.select}"
  chip-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
  field:
    backgroundColor: "{colors.content}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.tool}"
    padding: "5px 8px"
  field-label:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  table-head:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "6px 10px"
  table-row:
    height: "30px"
    padding: "4px 10px"
  table-row-selected:
    backgroundColor: "{colors.select-soft}"
  table-figure:
    textColor: "{colors.ink-2}"
    typography: "{typography.figure}"
  progress-track:
    backgroundColor: "{colors.sunken}"
    rounded: "{rounded.micro}"
    height: "6px"
  progress-fill:
    backgroundColor: "{colors.rule-2}"
    height: "6px"
  progress-fill-running:
    backgroundColor: "{colors.select}"
  jobs-strip:
    backgroundColor: "{colors.chrome}"
    height: "36px"
    padding: "5px 14px"
  jobs-strip-active:
    height: "58px"
    padding: "9px 14px 11px"
  log:
    backgroundColor: "{colors.sunken}"
    padding: "8px 14px 10px"
  banner:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    rounded: "{rounded.tool}"
    padding: "9px 11px"
  editor:
    backgroundColor: "{colors.content}"
    rounded: "{rounded.tool}"
    padding: "11px 13px"
  readout-numeral:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  readout-of:
    textColor: "{colors.ink-2}"
  empty:
    width: "56ch"
    padding: "30px 18px"
---

# Design System: Web → EPUB cho Kindle

## Overview

**Creative North Star: "Thư viện để bàn — the archivist's desktop instrument"**

This is a tool for one person archiving Vietnamese serial novels onto a Kindle. The
world it lives in is a desk instrument in the tradition of a professional ebook
library manager: the library is a dense hairline table, and a crawl is a job you
watch run. It refuses two category defaults at once — the converter page (centered
card, URL box, blue button, spinner) and the cream-paper-plus-serif rendition of
anything bookish. Precision of state over warmth of subject: a crawl is not
romantic, it is 148 of 149 chapters done with one failure, and the interface says
exactly that.

The system is one stylesheet with 22 color custom properties, and the dark scheme
adds no component variants. Light desktop chrome (`#ececec`) surrounds raised work surfaces
(`#f7f7f7`) on white content (`#ffffff`), separated only by hairlines. Two reserved
colors exist and nothing else is colored: blue is selection and live work, red is
failure. Every figure a person compares — chapter counts, cursors, timestamps — is
set in a mono face with tabular numerals, and exactly one numeral per pane is
allowed to be monumental. Rows are 30px, the command bar is 44px, pane heads are
40px, and the jobs strip grows from 36px to 58px when a job is in flight.

The interface rides the operating system's own faces and carries no webfont
pipeline, because the tool runs locally with no network dependency. All copy is
Vietnamese and stays Vietnamese; the vocabulary in use ("chương", "crawl",
"xuất EPUB", "Nhật ký", "Crawl tiếp", "Chờ crawl", "Đang crawl") is part of the
visual system, not a translation layer over it. PRODUCT.md's fourth principle —
the deliverable is the EPUB on the Kindle, not time spent in the tool — is what
justifies the density: nothing here is decorative, everything is a state or a
control.

**Key Characteristics:**
- Dense hairline data tables on light desktop chrome; 30px rows; separation by 1px rules, never by shadow or fill.
- Two reserved colors only — selection/work blue and failure red — never decorative; all other color is neutral gray.
- One display-scale numeral per pane (52px mono, tabular, 600, −0.03em) as the eye's landing point.
- Flat: no cast shadows anywhere; the only shadow in the system is the 1px inset press on an active button.
- A docked jobs strip that carries a live crawl: state, progress bar, cursor/total, error count, collapsible raw log.
- One dark scheme, produced by swapping the same 22 custom properties — no parallel dark stylesheet.
- Vietnamese UI copy, OS faces, no webfonts, no network dependency.

## Colors

A neutral, instrument-gray palette with exactly two reserved colors and no third accent.

### Primary
- **Instrument Blue** (`#3b6fb6`): the selection and live-work color. It marks the focused input border, the focused control's outline, text selection, links, checkbox accent, the primary button, a running job's chip, and a running progress bar. Its soft companion **Instrument Blue Wash** (`#e8f0fa`) fills a selected table row; **Instrument Blue Deep** (`#2f5c99`) is the primary button's hover and pressed background; **On Instrument Blue** (`#ffffff`) is the text that sits on top of it.

### Secondary
- **Failure Red** (`#b3261e`): the only other reserved color, used exclusively for error surfaces and error text — error banners, the error chip, a failed count in a table figure, an error line in the log, the destructive delete confirmation. It is accompanied by **Failure Wash** (`#fbecec`) for error fills and **Failure Rule** (`#e3b2af`) for the error border. It is never used for warning, attention, or emphasis.

### Neutral
- **Desk Chrome** (`#ececec`): the application's outer field — command bar and jobs strip.
- **Chrome Shade** (`#e2e2e2`): the pressed state of a neutral button; the only darker step of chrome.
- **Raised Plane** (`#f7f7f7`): pane heads, table column headers, and chips — every surface that should read as one step above content.
- **Content Plane** (`#ffffff`): panes, table bodies, inputs, and the chapter editor.
- **Sunken Plane** (`#e6e6e6`): the segmented control's trough, the log surface, and scrollbar tracks — the recessed plane.
- **Segment On** (`#ffffff`): a selected segment's fill; identical to Content Plane in light and deliberately separate in dark.
- **Row Hover** (`#f2f2f2`): the hover plane of a table row and the fill of an expanded chapter panel.
- **Ink** (`#1c1c1c`): primary text, table figures for good state, and the caret.
- **Ink 2** (`#4a4a4a`): secondary text, labels, column headers, and neutral figures.
- **Ink 3** (`#6f6f6f`): tertiary text — placeholders, sources, timestamps, hint lines.
- **Hairline** (`#d4d4d4`): the interior rule — the bottom edge of every table row, the divider under the metadata block, the box around the chapter editor.
- **Hairline Strong** (`#b9b9b9`): the structural rule — the line under the command bar, between panes, under pane heads and column headers, and the border of inputs and chips.
- **Button Face** (`#f2f2f2`) / **Button Face Hover** (`#e8e8e8`) / **Button Rule** (`#b9b9b9`): the neutral button's fill, hover, and border; separate tokens from the plane grays so the dark scheme can nudge the control family independently.

Note: Content Plane, Segment On, and On Instrument Blue all resolve to `#ffffff` in light and diverge in dark (`#1b1b1b`, `#383838`, `#10161f`) — that divergence is why they are three tokens and not one. The same is true of Hairline Strong and Button Rule, which coincide in light and separate in dark.

### Named Rules
**The Two Reserved Colors Rule.** Blue means selection or work in flight; red means failure. Nothing else in the interface may be blue or red, and neither may be used decoratively, for emphasis, or for warning. Every remaining surface is a neutral gray.

**The One Reserved Color Per State Rule.** A chapter's state wears at most one reserved color: running is blue, error is red, and pending and done wear no color at all — they are distinguished by ink weight and by the chip's border. There is no yellow, green, or amber state anywhere.

**The Browser Surface Rule.** The browser's own surfaces are themed with the same tokens: selection is Instrument Blue with white text, focus is a 2px Instrument Blue outline at 1px offset, the text caret is Ink, and the HTML `theme-color` is Desk Chrome (`#ececec` light, `#262626` dark) so the window frame matches the app.

## Typography

**Display Font:** the platform mono stack (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`)
**Body Font:** the platform UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`)
**Label Font:** the UI stack, uppercase at micro sizes

**Character:** two platform faces doing instrument work — a neutral UI grotesque for language and a monospace for every figure a person might compare. There is no display face: the monumental numeral is deliberately the same mono as a table cell, enlarged until it becomes the pane's landmark. The pairing is quiet, exact, and consistent with a tool that must run offline.

### Hierarchy
- **Display** (mono, 600, 52px, line-height 0.95, tracking −0.03em, tabular figures): the single monumental numeral in a pane, with its denominator beside it at 17px mono in Ink 2 and a 11px uppercase caption. 42px at ≤700px.
- **Title** (UI, 650, 16px, line-height 1.25, tracking −0.01em): the story title in the detail pane — the only place a title is not a 13.5px table cell.
- **Body** (UI, 400, 13.5px, line-height 1.45): all working text — table titles, pane copy, button labels at 13px (Control), banners at 12.5px, secondary lines at 12px.
- **Label** (UI, 650, 10.5px, +0.07em, uppercase): column headers, field labels, and the pane-head section name. Same treatment at 12px for the pane head, 11px for the numeral's caption, and 11.5px for chips.
- **Figure** (mono, 400, 12.5px, tabular figures): every number in a table, plus a job's cursor/total at 12px. Good-state figures are Ink at 600 inside the cell; failed counts are Failure Red.
- **Reading text** (UI, 400, 14px, line-height 1.65, max 72ch): the chapter body inside the editor — the one place in the app set for reading, not scanning, and still in the working UI face at the app's body-adjacent size.

### Named Rules
**The Monumental Numeral Rule.** A pane contains at most one numeral at display scale, and it must be the pane's most important figure — chapters crawled, or chapters extracted. It is never decorative, never repeated, and never larger than 52px. Everything else is set at working sizes.

**The Tabular Figures Rule.** Every number a person compares across rows or across time is mono and `font-variant-numeric: tabular-nums`: table figures, the chapter number, the monumental numeral and its denominator, a job's cursor/total. Proportional figures appear nowhere in the interface.

**The Edge Label Rule.** Uppercase micro-labels exist only where they label something real — a table column, a form field, a region name in a pane head. A label is never a decorative kicker above a heading, and it never carries information the heading already gives.

**The OS Faces Rule.** The interface uses the operating system's UI stack and mono stack, with no webfont and no network request. This is a product constraint (the tool runs locally and must work offline), not a typographic preference; a webfont would be a functional regression.

## Layout

The app is a three-row grid — command bar, workbench, jobs strip (`auto / minmax(0, 1fr) / auto`) at full viewport height. The workbench splits into two panes at `minmax(0, 29fr) minmax(0, 21fr)` — the library table on the left at ~58%, the selected story's detail on the right at ~42%. Panes are separated by a 1px Hairline Strong border, never by gap or shadow.

Density is fixed and desktop-first, and the rhythm is stated in exact values: 44px command bar, 40px pane heads, 30px table rows (6px of vertical padding inside the header cell, 4px inside a data cell, 10px horizontal), 36px idle jobs strip growing to 58px when a job is active. Pane content sits on 14px padding with 13px between detail blocks; form fields are a two-column grid with 9px/12px gaps; the log caps at 190px tall. A story with 149 chapters is one pane of 30px rows that scrolls — the pane body is the scrolling element, never the page.

Tables use `table-layout: fixed` deliberately: no content may ever widen a table again. A 149-chapter title or a multi-line Playwright failure string ellipsizes in its cell (`text-overflow: ellipsis`, `white-space: nowrap`) instead of pushing columns, and the job strip's job label caps at 34ch with the same treatment. Header cells are sticky at the top of the scroll with `z-index: 2`, the only stacking in the system.

Responsive behavior is two breakpoints, both degradations of a desktop instrument:
- **≤1100px:** the workbench stacks into one column — library table on top (44fr), detail below (56fr) — and the pane divider moves from left edge to top edge.
- **≤700px:** the command bar wraps to its own height (8px/12px padding), form fields collapse to one column, the monumental numeral drops to 42px, the jobs strip stops pushing its trailing controls to the right edge, and tables keep a `min-width: 42rem` floor so a narrow screen scrolls a data table sideways rather than crushing the title column. The story table's XONG / LỖI / CẬP NHẬT columns are then one sideways scroll away — an accepted cost, because desktop is the confirmed primary context.

### Named Rules
**The Fixed Table Rule.** Every data table is `table-layout: fixed` with ellipsizing cells. If a value does not fit, it is truncated with the full value in a `title` attribute — a table is never widened by its content, and a row is never wrapped to two lines.

**The 30px Row Rule.** Data rows are 30px and never grow; an expanded chapter's editor opens into a *separate* full-width row below the collapsed one, so the collapsed row keeps its 30px and its place in the scan. Command bar 44px, pane heads 40px, jobs strip 36px idle / 58px active — these four heights are the system's skeleton.

**The 42rem Floor Rule.** Below 700px a data table keeps a 42rem minimum width and its pane scrolls horizontally. Crushing columns is never the responsive answer; scrolling a table is.

## Elevation & Depth

The system is flat, and depth is drawn rather than cast. There is no `box-shadow` in the interface except one inset press cue on an active button — separation is achieved entirely by 1px rules: Hairline for interior edges (each row's bottom border, the divider under the metadata block, the box around the chapter editor) and Hairline Strong for structural boundaries (under the command bar, between panes, under pane heads and column headers, around inputs and chips). Plane changes — raised pane head, sunken log, sunken segmented trough — carry the rest of the hierarchy without ever floating.

Nothing is elevated: no dropdowns, no popovers, no modals exist in the system, so nothing needs a cast shadow. The sticky column header is the only element with a `z-index` (2), and it separates itself with the same 1px rule plus its raised fill, not with a shadow.

### Shadow Vocabulary
- **Press cue** (`box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.07)`): the only shadow in the system; appears on `:active` of a neutral button to confirm the press. Never used at rest, never used for depth.

### Named Rules
**The Drawn-Not-Cast Rule.** Separation is a hairline, not a shadow. A new surface is introduced with a 1px rule and a fill from the plane family; if a design needs a cast shadow to read, the plane hierarchy — not the shadow — is wrong.

**The Scroll Chrome Rule.** Scrollbars are part of the surface: an 11px rail in the Sunken plane with a Hairline Strong thumb inset by a 3px Sunken border and rounded 6px, darkening to Ink 3 on hover. Both axes match, and the corner is filled with the rail.

## Shapes

The form language is squared and technical. The tool radius is **3px** — buttons, inputs, selects, banners, the segmented trough, the chapter editor. Micro parts are **2px** — status chips, segment buttons, progress bars. Nothing else is rounded except the scrollbar thumb (6px) and the operating system's own checkbox. There are no pills, no capsules, no circles, and no radius above 3px in the component layer.

Borders are always 1px and always a rule token; a boxed element is drawn by its border rather than by a fill shift or a shadow. The progress bar clips its fill with `overflow: hidden` and rounds to 2px; the chapter editor box is a 1px Hairline around a Content plane with 11px/13px padding inside. Long text takes the shape of its container: single-line values ellipsize with a trailing ellipsis, while error strings and URLs break anywhere rather than overflowing. Native controls are kept only where drawing them by hand would be a lie: the checkbox stays native (14px, themed through `accent-color`) and the file picker keeps its OS button, while `<select>`, `<input>`, and `<textarea>` all wear the input treatment.

### Named Rules
**The 3px Ceiling Rule.** Radius tops out at 3px. If a surface needs to feel softer, the answer is a plane change or a hairline — not a bigger radius.

**The Hairline Box Rule.** Every enclosed region is drawn with a 1px rule: the chapter editor, the banner, the input, the chip, the progress track. A filled box with no border reads as a plane, not as a component.

## Components

### Buttons
- **Shape:** 3px radius (Tool), 1px Button Rule border, 5px/11px padding, 13px UI text with a 6px gap to a 12–14px inline icon.
- **Neutral:** Button Face fill, Ink text; hover steps to Button Face Hover; pressed steps to Chrome Shade with the inset press cue.
- **Primary:** Instrument Blue with On Instrument Blue text at 600; hover and pressed both step to Instrument Blue Deep (the pressed state is not further distinguished — the color is already the strongest signal in the system).
- **Danger:** Failure Wash fill, Failure Red text at 600, Failure Rule border — used only for the destructive delete confirmation.
- **Quiet:** transparent fill and border with Ink 2 text; hover reveals a Button Face Hover fill and Ink text. This is the row-level action style (open source, log toggle, back).
- **Tiny:** a size modifier only — 2px/8px padding and 12px text — used inside table rows and the jobs strip, never as a page's primary action.

### Chips
- **Style:** Raised plane fill, Hairline Strong border, 2px radius, 1px/7px padding, 11.5px semibold text, 5px gap to a 12px icon. Sentence case, never uppercase.
- **State:** pending is neutral (clock icon, "Chờ crawl"); running flips to Instrument Blue Wash fill with Instrument Blue text and a pulsing dot ("Đang crawl"); error flips to Failure Wash with Failure Red text ("Lỗi"); done stays neutral with a check and no color ("Xong"). A manual-entry chip swaps in an edit icon on the neutral treatment. The chip is the only place a chapter's state is written in color — the row stays neutral.

### Panes / Containers
- **Corner Style:** square; panes are regions, not cards.
- **Background:** Content plane for the pane body, Raised plane for the 40px pane head, Desk Chrome for the command bar and jobs strip.
- **Border:** 1px Hairline Strong between panes and under pane heads; interior blocks divide with 1px Hairline.
- **Internal Padding:** 14px for pane content and the metadata block, 13px between detail blocks, 10px horizontal in table cells.
- **Scroll:** the pane body scrolls (`overflow: auto`), not the page.

### Inputs / Fields
- **Style:** Content plane fill, 1px Hairline Strong border, 3px radius, 5px/8px padding, 13px text. Labels are 10.5px uppercase Ink 2 above the control with a 4px gap; the label is a real `<label>` and a visually-hidden label is used when the design wants a placeholder instead.
- **Focus:** the border turns Instrument Blue, plus the global 2px Instrument Blue outline at 1px offset. There is no glow and no shadow.
- **Textarea:** identical treatment at 12.5px/1.55, vertically resizable. **File input:** the native control with a themed selector button matching the neutral button family. **Checkbox:** the native control at 14px, accent-colored Instrument Blue; it and the file picker's OS button are the only un-reskinned controls.

### Navigation
- **The command bar** is the only navigation: a 44px Desk Chrome strip with the product name at left ("Web → EPUB" at 14px/600 with "CHO KINDLE" as an 11.5px uppercase qualifier beside it), the two tabs centered, and a status slot pushed right. The status slot is the app's live indicator: a running crawl shows the blue chip with "Đang crawl 12/233"; idle shows a neutral info line with the supported-site count.
- **Tabs** are a segmented control, not underlined tabs: a Sunken trough with a 1px Hairline border at 3px radius, 2px padding, and 2px-radius buttons inside. Unselected segments are Ink 2 with transparent fill; the selected segment is Segment On with Ink text at 600 — selection is a plane change plus weight, never the accent color. Each segment carries a 14px icon and its Vietnamese label.

### Data Table (signature)
A fixed-layout table of 30px rows on the Content plane. Column headers are 10.5px uppercase labels on the Raised plane, sticky, with the numeric columns right-aligned; figures are mono and tabular, good counts in Ink 600 and failures in Failure Red 600. Rows are hoverable (Row Hover) and selectable (Instrument Blue Wash with the title turning Instrument Blue). Titles ellipsize with the full value in a `title`; secondary cell values (site, relative time) are Ink 3 and ellipsize too. Row actions live in a trailing cell and are quiet, tiny buttons revealed by the row's state — a neutral trash on the library row, a "Thử lại" retry button on a failed chapter. The library table's columns are Truyện / Site / Chương / Xong / Lỗi / Cập nhật; the chapter table's are a checkbox / # / Chương / Trạng thái / action.

### Chapter Row — the row is the editor (signature)
A chapter is one 30px row: include-checkbox, number, a chevron plus title as a full-width disclosure button, a state chip, and the row's action. It expands — never a modal — into a second full-width row tinted Row Hover that holds the source link, the title field, and a contentEditable body in a Hairline box. The chevron rotates 200ms on disclosure. A failed chapter's expansion shows the failure banner with the raw Playwright message in 11.5px mono, a "Thử lại" button, and — once a retry has been attempted — the "Nhập nội dung thủ công" escape hatch, because extraction is never the authority. 149 chapters therefore render as a dense list of rows, not 149 open editors.

### Readout Numeral (signature)
The pane's landmark: the count at 52px mono/600 in Ink with `−0.03em` tracking and tabular figures, the denominator ("/149") at 17px mono in Ink 2, and an 11px uppercase caption ("CHƯƠNG ĐÃ CRAWL") beside them, on a baseline-aligned row. Below it, one 12px status line: pending count, error count in Failure Red 600, or the sentence that everything is done. The monumental numeral never appears twice in a pane and never appears outside a readout.

### Jobs Strip (signature)
A strip docked across the bottom edge on Desk Chrome, 36px when idle and 58px when a job is active, with a 1px Hairline Strong top border. It carries the job state (pulsing dot + label, or a check/alert + "Xong · label" when finished), a 6px progress bar that spans its own full-width row, mono cursor/total and error counts, and a trailing quiet toggle for the raw log. The log opens above the strip on the Sunken plane, 190px max, in 11.5px mono with timestamps in Ink 3 and error lines in Failure Red, auto-scrolling only while the user is already at the bottom. Error counts here and in the readout are the same Failure Red; nothing else in the strip is colored.

### Progress Bar
A 6px track in the Sunken plane with a 1px Hairline border and 2px radius; the fill is Hairline Strong when the bar represents a finished run and Instrument Blue while running. The fill is a full-width element scaled with `transform: scaleX()` — never an animated `width` — so progress updates stay on the compositor.

### Banner
The error banner is Failure Wash with a 1px Failure Rule border at 3px radius, 9px/11px padding, 12.5px Failure Red text, an inline alert icon, and `overflow-wrap: anywhere` so a URL or Playwright string cannot stretch the layout. A list inside it (unsupported URLs) is 11.5px mono with `word-break: break-all`. Banners report; they do not ask — there is no dismiss control, no modal, and no `alert()`.

### Empty State
A bounded block (56ch max, 30px/18px padding) with a 14px/650 heading, a short paragraph, and an ordered list of three steps that teaches the flow — paste a URL, all chapters arrive as "Chờ crawl", close the tab whenever because progress lives in the library. It is the only place the tool explains itself, and it is set in working type at working sizes.

### Icons
A single inline SVG set: a 20×20 viewBox drawn at 12–14px, `stroke-width: 1.6`, round caps and joins, `currentColor`, no fills except the play triangle and the running dot. Seventeen glyphs cover the whole product (crawl, library, play, retry, download, upload, chevron, check, alert, clock, x, trash, edit, chapter, dot, info, open). No icon font, no icon library, no emoji.

### Vietnamese Copy
UI copy is Vietnamese and stays Vietnamese — labels, states, empty states, errors, and buttons. The vocabulary is fixed: "chương" (not chapter), "crawl" (kept as-is, never "thu thập"), "xuất EPUB", "Nhật ký", "Crawl tiếp", "Chờ crawl", "Đang crawl", "Truyện của tôi", "Crawl thủ công". States are sentence case in chips ("Xong", "Lỗi") and uppercase only in column headers and labels.

## Do's and Don'ts

### Do:
- **Do** keep every figure a person compares in the platform mono with `font-variant-numeric: tabular-nums` — table cells, cursors, counts, the monumental numeral.
- **Do** reserve Instrument Blue for selection and live work and Failure Red for failure; leave every other surface neutral.
- **Do** express state in the row itself — chip, checkbox enablement, row action, and the numeral — so a chapter's condition is readable at 30px without expanding anything.
- **Do** separate surfaces with 1px Hairline / Hairline Strong rules and a plane change (Chrome → Raised → Content → Sunken); introduce depth with planes, not shadows.
- **Do** use `table-layout: fixed` and ellipsize long titles, keeping the full value in a `title` attribute.
- **Do** keep the four skeleton heights: 44px command bar, 40px pane heads, 30px rows, 36px/58px jobs strip.
- **Do** open a chapter editor as a second full-width row under its collapsed 30px row, and keep everything else at 3px radius (2px for chips, segments, and bars).
- **Do** keep all UI copy in Vietnamese, riding the OS UI and mono stacks with no webfont.
- **Do** send every long-running crawl into the docked jobs strip with a label, a cursor/total, an error count, and the collapsible raw log — and keep the log's auto-scroll conditional on the user already being at the bottom.
- **Do** animate progress with `transform: scaleX()` over 240ms (`cubic-bezier(0.22, 1, 0.36, 1)`), the chevron with a 200ms rotation, and running indicators with a pulse — state-driven motion only.

### Don't:
- **Don't** use blue or red decoratively, for emphasis, or for a third meaning; there is no warning color, no success green, and no informational amber.
- **Don't** add a cast shadow, a glow, or a floating surface; the only permitted shadow is the inset press cue on an active neutral button.
- **Don't** round anything above 3px — no pills, no capsules, no circular icon buttons, no card corners.
- **Don't** let content widen a table or wrap a row: truncate with ellipsis, never crush the title column, and let a narrow viewport scroll the table sideways behind its 42rem floor.
- **Don't** replace the docked jobs strip with a spinner, a toast, or a modal; a running crawl is a job, and it is always visible.
- **Don't** introduce a second reserved color, a second accent, or a second display numeral in a pane.
- **Don't** add a webfont, an icon font, an icon library, or an emoji glyph; the interface must work with no network dependency.
- **Don't** use uppercase micro-labels as decorative kickers above headings; they exist only on real columns, fields, and region names.
- **Don't** open a chapter editor in a modal, a drawer, or an inline expansion that changes the collapsed row's height — the row is the row.
- **Don't** translate the UI copy: "chương", "crawl", "xuất EPUB", "Nhật ký", "Crawl tiếp", "Chờ crawl", and "Đang crawl" are the system's words, not placeholders.
