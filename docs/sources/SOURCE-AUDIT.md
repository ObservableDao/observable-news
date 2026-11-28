# M0 source-permission audit (register v1, 28 November 2026)

Machine-readable register: `config/sources.json`. Verdict: `node scripts/source-coverage.mjs`.
This is a research record, not legal advice. Where a right is unclear it is recorded as **pending**,
and pending counts as "no".

## Rules applied

* **Commercial publishers:** nothing without written permission (UK headlines can carry copyright).
* **Creative Commons 4.0:** the licence permits sharing the work "in whole or in part", so an unaltered
  headline with a link and credit is covered. Grouping separate items is a collection, not an adaptation.
* **No-derivatives licences:** headlines are shown unaltered, so they are covered. Shortened excerpts could be
  read as abridgments, so excerpts stay pending unless the publisher explicitly allows opening lines.
* **Non-commercial licences:** usable only while Observable carries no advertising or sponsorship and sells
  nothing. This is recorded as a register assumption; changing it removes those sources.
* **Publisher guidelines that go beyond the licence** (for example "no automatic republishing" or "no curation
  platforms"): Creative Commons treats such extras as requests, but the register still marks the source pending
  until the publisher confirms in writing.

## Result

| Section | Headline sources (confirmed) | Meets 3? |
| --- | --- | --- |
| UK | Liberty Investigates, GOV.UK, UK Parliament, ONS | Yes |
| World | Global Voices, Mongabay, GOV.UK (FCDO) | Yes |
| Science & Space | Mongabay, Climate Feedback, Knowable Magazine, NASA, GOV.UK | Yes |
| Technology & AI | Tech Policy Press, GOV.UK | No (2) |
| Business | GOV.UK, ONS | No (2) |

**Independent news organisations with confirmed headline rights: 6** (Global Voices, Mongabay,
Tech Policy Press, Climate Feedback, Knowable Magazine, Liberty Investigates) across 4 sections.
The 5-across-3 target is met by published licence. It is **not yet met under the strict M0 rule**, which needs an
archived copy of each source's terms with its SHA-256; the benchmark workflow produces those archives.

Audited: 23 of the 40 sources M0 asks for.

## Viability

* The gate can be met with no money and no permission letters, but the result is **specialist**: environment,
  science, technology policy, citizen media and UK investigations. It is not yet a general UK news briefing.
* UK independent coverage rests on one low-volume source. The briefing's one-third independent balance rule will
  often fall back to government items in UK and Business.
* Technology & AI and Business need one more confirmed source each, or launch with three sections.
* The decisive pending sources are **The Conversation UK** (all five sections), **openDemocracy**, **TBIJ**,
  **Carbon Brief**, **Rest of World** and the **Guardian** (the Guardian also needs an API key, which is a
  credential you have not approved).
* Item volume per source is unmeasured: the live benchmark records it.

## Pending, and what each needs

| Source | Blocker |
| --- | --- |
| The Conversation UK | Guidelines bar systematic republishing; written confirmation of automated headline links |
| The Guardian | API key (credential) and written confirmation; a clause reportedly restricts text mining |
| openDemocracy | Regular use (more than two pieces a month) should be agreed |
| TBIJ | "Use our work" conditions not yet read |
| Carbon Brief | Licence notice covers reproduction "in full"; headline-only use unclear |
| ProPublica | No automatic or wholesale republishing |
| The New Humanitarian | No submission to curation platforms |
| Inside Climate News | No syndication to platforms, no automatic republishing |
| Rest of World | Agreement required (free for non-profits) |
| The Markup (CalMatters) | Per-story conditions not verified |
| Bank of England | Copyright reserved; authorisation needed |
| ESA | Website text for personal non-commercial use |

Undark is recorded as not permitted (no open licence; wholesale republishing barred).
Draft permission requests are in the private desk repository for you to send.
