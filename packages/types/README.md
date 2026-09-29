# @ziffer-io/types

The ZIFFER wire format as TypeScript types.

## Install

```bash
npm install @ziffer-io/types
```

Most integrations never install this directly. `@ziffer-io/client` depends on it, so installing
the client brings the wire types with it.

## Usage

```ts
import type { wire } from '@ziffer-io/types';

function store(receipt: wire.DecisionReceipt): void {
  // your code
}
```

These types are generated from the ZIFFER specification. The specification is public at
https://github.com/ziffer-hq/ziffer-spec. A field this package does not carry is a field the
specification does not state. The package holds types only, so nothing here calls an API or
checks a signature.

## Documentation

- The specification: https://ziffer.io/docs/specification
- Integrating the SDK: https://ziffer.io/docs/developers/sdk
- Quickstart: https://ziffer.io/docs/quickstart
- Glossary: https://ziffer.io/docs/glossary

## Support

Write to hello@ziffer.io.

## License

Apache License 2.0: see `LICENSE` beside this file, and `NOTICE`. Copyright 2026 code75 SASU.
ZIFFER is a registered trademark of code75 SASU, and the licence does not grant it. The
open-source components this package redistributes are listed in `THIRD-PARTY-NOTICES`, under
their own licences.
