# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use the private channel: this repository's **Security** tab →
**Report a vulnerability**. The report is visible only to the maintainers.

If the button is missing, the repository owner has not enabled private
reporting yet — in that case open a public issue that says only "security
report, need a private channel", with no technical detail, and the maintainer
will open one.

## What is in scope

- the Admin UI: authentication, the rate limiter, session handling, stored
  instance secrets, anything that turns a panel page into remote code or a
  credential leak;
- the subscription server: URL guessing, mirror keys, encrypted payloads,
  anything that hands a profile to someone who should not have it;
- the installer and the updater: signature and checksum checks, download
  paths, the launcher wrapper, privilege boundaries between `root` and the
  `olcrtc` service user;
- the exit node: traffic leaving the tunnel from a host that should not be
  able to reach it.

Out of scope: the exit node's IP being blocked by carriers, and anything that
needs an already-compromised `root` shell on the host.

## What to expect

- acknowledgement within 72 hours;
- a fix or a mitigation plan before any public write-up;
- credit in the release notes if you want it.
