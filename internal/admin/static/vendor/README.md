# Vendored browser libraries

Copied in as-is from the versions the panel used to load from cdnjs, so the panel
does not depend on a third-party CDN that may be slow or unreachable from the
VPS. Both files are minified and unmodified.

| File | Package | Version | Source | Licence |
|---|---|---|---|---|
| `qrcode.min.js` | qrcodejs (davidshimjs) | 1.0.0 | https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js | MIT |
| `pako.min.js` | pako | 2.1.0 | https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js | MIT (zlib) |

They are served by the embedded static handler under `/vendor/`, the same way as
every other file in this directory. To update one, drop the new minified file
here and bump the version in this table; nothing else references the version.

`qrcode.min.js` provides the global `QRCode` used by `showQRModal`.
`pako.min.js` provides the global `pako` used to unpack subscription payloads.
