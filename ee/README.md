# ee/

This directory will hold the paid features of HexProcure: the AI lanes beyond
bring-your-own-key extraction, the Team and Business connector packs, the
write tools of the MCP server, SSO and similar. Today it holds `features.ts`,
the single map from feature id to the minimum tier that unlocks it. Everything outside `ee/`
is MIT and stays free.

The code here is source-available under the HexProcure Commercial Licence
(see `LICENSE`), licensor HEXENKRAFT s.r.o., Czech law. You can read it,
modify it and send contributions without a key. Using it in production needs a valid
licence key, and in production the licence check in `src/lib/license.ts`
must stay in place.

To get a key, pick a tier from `features.ts` and write to matic@hexenkraft.cz.
You receive a quote. The order you confirm names your legal entity, the tier,
the validity period and the fee, and carries this acceptance line, which Czech
law needs in writing for the defects waiver and the venue clause to bind:

> We accept the HexProcure Commercial Licence v1.0, including sections 8, 9,
> 10 and 11, and waive rights from defective performance as section
> 9 states, for the licence key issued under this order.

After payment you receive a signed token. Set it as `HEXPROCURE_LICENSE` and
restart. The key is checked offline against the Licensor's public key built
into `src/lib/license.ts`. Without a valid key the app runs as
Community and locked features stay off.
