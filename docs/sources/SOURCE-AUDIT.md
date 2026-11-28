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

## Result (after the first live check, 28 November 2026)

The benchmark workflow fetched every source whose Fetch right was confirmed, honouring robots.txt with an
identified user agent. It archived 7 terms pages with their SHA-256 (recorded in the register). Most terms pages are
dynamic, so the raw-page hash differs on every fetch. The register therefore also records `textSha256`, a hash of
the visible text, which stayed identical across runs and is what change monitoring should compare.
Archived copies are kept as workflow artifacts for 90 days; durable storage in the private repository is still to decide. It also
changed four entries:

* **Knowable Magazine** and **UK Parliament** refuse requests from an identified user agent (403). Both are now
  pending: ask Knowable, and find an official Parliament feed or data API.
* **Climate Feedback** has moved to science.feedback.org; the licence page cited in the audit now returns 404,
  and its feed links to the new domain. It is pending until re-audited.
* **Liberty Investigates** keeps its rights, but its own feed's newest item is from January 2020.
* **Tech Policy Press** (review, 28 November): its licence permits headlines, but its additional requests ask
  users to select individual articles rather than systematically republish all of them, and it publishes a
  text-and-data-mining reservation. Automated headline aggregation is systematic use of every item, so, as with
  ProPublica and The Conversation, it is pending until Tech Policy Press confirms in writing.

| Section | Headline sources (confirmed, terms archived) | Active feed | Meets 3? |
| --- | --- | --- | --- |
| UK | Liberty Investigates, GOV.UK, ONS | GOV.UK, ONS | Yes (legally); 2 active |
| World | Global Voices, Mongabay, GOV.UK | all three | Yes |
| Science & Space | Mongabay, GOV.UK, NASA | all three | Yes |
| Technology & AI | GOV.UK | GOV.UK | No (1) |
| Business | GOV.UK, ONS | both | No (2) |

**Independent news organisations with confirmed headline rights: 3** (Global Voices, Mongabay,
Liberty Investigates), **two short of the 5 required. Only 2 publish to an active feed.**
The M0 source gate is **not met**. Audited: 23 of the 40 sources M0 asks for.

## Viability

* Openly licensed sources alone do not make a credible general briefing. The confirmed independent output is
  low: Global Voices about 1 item a day and Mongabay about 13 (environment only).
* UK independent coverage is effectively nil without written permission.
* The gate needs **two more** of: The Conversation UK (covers all five sections), Tech Policy Press,
  openDemocracy, TBIJ, Carbon Brief, Rest of World, or a re-audited Climate Feedback. A credible UK briefing needs
  The Conversation UK and at least one of openDemocracy, TBIJ or the Guardian.
* Recommendation: send the permission requests now, starting with The Conversation UK
  (uk-republish@theconversation.com). Keep building the site against the confirmed set, because the
  pipeline is independent of which sources are approved.

## Pending, and what each needs

| Source | Blocker |
| --- | --- |
| The Conversation UK | Guidelines bar systematic republishing; written confirmation of automated headline links (uk-republish@theconversation.com) |
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
| Knowable Magazine | Refuses requests from an identified user agent (403) |
| UK Parliament | Refuses requests from an identified user agent (403); needs an official feed or API |
| Climate Feedback | Moved to science.feedback.org; licence to re-audit |

Undark is recorded as not permitted (no open licence; wholesale republishing barred).
Draft permission requests are in the private desk repository for you to send.
