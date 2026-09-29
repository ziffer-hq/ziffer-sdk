## Fonts in the HTML report: Schibsted Grotesk and IBM Plex Mono

The HTML report this server's scan writes (through `@ziffer-io/scan`, `--report`) embeds three font
files as base64 `@font-face` sources, so the report loads nothing. The files ship in
`@ziffer-io/scan` under `assets/fonts/`, unmodified, with the licence text in
`assets/fonts/OFL.txt` and a README naming each file.

- **Schibsted Grotesk**, variable, weights 400 to 900, Latin subset, version 1.100. Copyright 2023
  The Schibsted-Grotesk Project Authors (https://github.com/schibsted/schibsted-grotesk). Licence:
  SIL Open Font License, Version 1.1.
- **IBM Plex Mono**, Regular and Medium, Latin subset, version 2.3. Copyright 2017 IBM Corp., with
  Reserved Font Name "Plex" (https://github.com/IBM/plex). Licence: SIL Open Font License,
  Version 1.1.

These are not npm dependencies, so `THIRD-PARTY-NOTICES` beside this file cannot list them from the
resolved tree; it points here instead.
