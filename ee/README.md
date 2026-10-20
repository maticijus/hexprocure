# ee/

This directory holds the paid features of HexProcure: the AI lanes beyond
bring-your-own-key extraction, the Team and Business connector packs, the
write tools of the MCP server, SSO and similar. `features.ts` is the single map
from feature id to the minimum tier that unlocks it. Everything outside `ee/`
is MIT and stays free.

The code here is source-available under the HexProcure Commercial Licence
(see `LICENSE`, currently a draft for legal review). You can read it, modify it
and send contributions without a key. Using it in production needs a valid
licence key, and the licence check in `src/lib/license.ts` must stay in place.

To get a key, pick a tier in `docs/pricing-tiers.md` and contact
licensing@hexprocure.dev (placeholder, founder confirms). You receive a signed
token. Set it as `HEXPROCURE_LICENSE`, together with `HEXPROCURE_LICENSE_PUBLIC_KEY`,
and restart. The key is checked offline. Without a valid key the app runs as
Community and locked features stay off.
