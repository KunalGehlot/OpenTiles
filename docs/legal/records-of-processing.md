# Records of processing activities

Verzeichnis von Verarbeitungstätigkeiten under Art. 30 GDPR (P2-17). OpenTiles processes very
little personal data, and most of it never leaves the user's device; this record is kept anyway
(docs/legal-guardrails.md, "Data protection"). Keep it in step with the privacy policy
(`apps/web/src/legal/LegalPages.tsx`) and with what the code does. This is not legal advice; it is
reviewed with the lawyer before the public launch (P2-18).

Last reviewed: 2026-10-07.

## Controller

Kunal Gehlot, Kunal.gehlot@rwth-aachen.de, website <https://gehlot.site/> (contact only; the
postal address is not published in this repository, see P2-18).
No data protection officer is required (fewer than 20 people process personal data, § 38 BDSG).

## Not processing by the controller

These happen only on the user's device. The controller has no access, so they are listed for
completeness, not as processing activities:

- Private library (imported files, converted notes, titles, file names, import settings), progress,
  practice days and settings in IndexedDB.
- Microphone audio, analysed in memory in the browser; never stored or sent.
- Encrypted backup files, created and downloaded on the device; never uploaded.

## 1. Delivering the web app (static hosting)

| Item               | Entry                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Serve the app's files to the browser                                                                                                                                                                                                                                       |
| Legal basis        | Art. 6(1)(f) GDPR, legitimate interest in running the website                                                                                                                                                                                                              |
| Data subjects      | Visitors                                                                                                                                                                                                                                                                   |
| Data               | IP address, time, requested file, user agent, referrer (web-server access log)                                                                                                                                                                                             |
| Recipients         | GitHub, Inc. (GitHub Pages, ADR 0016). GitHub logs and stores visitors' IP addresses for security purposes; whether it acts as processor or as a separate controller for this, and which data processing terms apply to a personal account, is open for the lawyer (P2-18) |
| Third countries    | USA (GitHub, Inc.), under the EU-U.S. Data Privacy Framework adequacy decision (Art. 45 GDPR); GitHub's CDN serves from locations worldwide                                                                                                                                |
| Retention          | Set by GitHub; Pages has no setting for it                                                                                                                                                                                                                                 |
| Technical measures | HTTPS only; no cookies; no third-party requests from the app                                                                                                                                                                                                               |

## 2. Optional encrypted sync (P3-03)

| Item               | Entry                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Keep a user's encrypted library in step across their devices                                                                                                                 |
| Legal basis        | Art. 6(1)(b) GDPR, providing the service the user signs up for                                                                                                               |
| Data subjects      | Users who switch sync on                                                                                                                                                     |
| Data               | Email address; encrypted records with size, version and change time; wrapped library key; passkey public keys; session and passkey last-use times; session token hashes      |
| Not processed      | Titles, file names, file contents, progress and settings in readable form; passphrase; recovery code; library key; IP addresses (used in memory for rate limits, not stored) |
| Recipients         | EU hosting provider and EU object storage (processors); email delivery provider for sign-in links (processor)                                                                |
| Third countries    | None                                                                                                                                                                         |
| Retention          | Until the user deletes the account (one step, in Settings); sessions expire 90 days after last use; sign-in links after 15 minutes                                           |
| Technical measures | End-to-end encryption (AES-256-GCM, Argon2id-wrapped key), random record ids, request logs without ids or addresses, see docs/sync.md                                        |

## 3. Opt-in crash reports (P3-08)

| Item               | Entry                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Find and fix errors that stop the app                                                                                        |
| Legal basis        | Art. 6(1)(a) GDPR, consent (off by default, withdrawn in Settings at any time)                                               |
| Data subjects      | Users who switch crash reports on                                                                                            |
| Data               | Error message and stack trace (scrubbed of titles, file names, ids, links and email addresses), app version, coarse platform |
| Recipients         | EU hosting provider (processor)                                                                                              |
| Third countries    | None                                                                                                                         |
| Retention          | 30 days; time stored rounded down to the hour; not linked to an account or IP address                                        |
| Technical measures | Scrubbing on the device (`apps/web/src/crash/scrub.ts`) and again on the server; size and rate limits                        |

## 4. Notice-and-takedown and other email

| Item            | Entry                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------- |
| Purpose         | Handle copyright notices about catalogue pieces and other requests                           |
| Legal basis     | Art. 6(1)(c) and (f) GDPR                                                                    |
| Data subjects   | People who write to the contact address                                                      |
| Data            | Name, email address, message content                                                         |
| Recipients      | Email provider of the contact address                                                        |
| Third countries | None intended                                                                                |
| Retention       | Deleted when the matter is closed, unless statutory retention applies (then until it lapses) |

## Open items before launch

- Data processing agreements with the web host, the sync host, object storage and the mail
  provider.
- Lawyer review (P2-18).
