#!/usr/bin/env python3
"""The audit chain export corpus (ACP-428): one set of files, three readers.

    PYTHONPATH=$ACP_REPO_PATH/reference/src python3 gen_chain_corpus.py          # write
    PYTHONPATH=$ACP_REPO_PATH/reference/src python3 gen_chain_corpus.py --check  # compare

WHY A SHARED CORPUS. The console's download link says the audit chain it
hands out is verifiable offline, and two readers now say so: the Python SDK's
`verify_chain` and `@ziffer-io/verify`'s `verifyChain`. Two readers of one file
that are each tested against their own fixtures agree with themselves; the
claim that they agree with EACH OTHER is only true of inputs both were handed.
So both suites read these files and compare against `expected.json`, and a
reader that drifts goes red against the same line the other one still passes.

WHERE THE EXPECTED VERDICTS COME FROM -- not from either reader. The source is
`services/wire/fixtures/console-v2/export.json`, the audit service's own answer
to the export route, written by `services/anchor/tests/wire.rs`: its chain
hashes were computed by the Rust audit service and its anchor was signed by
that test's seeded anchor identity. Every `last_chain_hash` below is copied
from that file's rows, never recomputed here, so a reader agreeing with it is
agreeing with the writer. Every refusal below is named by CONSTRUCTION -- this
script knows which byte it flipped -- and not by running a verifier.

WHAT THE CUSTOMER HOLDS. `anchor-identity.pub` is the anchor identity's
public document derived from the seed that test signs with, by the
reference's own `HybridKey` -- derived here, never lifted out of the export's
`anchor_identity` field. That field is in every export and a verifier must
never read it: a file that carries the key it is verified with proves only
that its author could sign. `export-forged-anchor.json` is that attack.

DETERMINISTIC, so `--check` compares bytes: Ed25519 is deterministic, and the
forged anchor's ML-DSA-65 half is signed with FIPS 204's deterministic
variant. The Python SDK's tests call `derive()` with the SDK's vendored engine
and compare, so the corpus drifting from its source is a red test, not a
re-run somebody has to remember.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "..", "..", "..", "..", "services", "wire", "fixtures",
                      "console-v2", "export.json")
SOURCE_NAME = "services/wire/fixtures/console-v2/export.json"
SOURCE_REV = "0ce0567bec3ee9d8c2b58d8c26c1ec83c4782f72"

# The seed services/anchor/tests/wire.rs signs the console fixtures' anchor
# with (`fixture_evidence`), and an attacker's, for the forged anchor.
ANCHOR_SEED = b"acp-48 M7 audit wire test anchor identity"
FORGER_SEED = b"ACP-428 corpus: an identity that is not the customer's anchor"
SUITE = "hybrid-ed25519-mldsa65"


def _text(doc) -> str:
    """The console's own serialisation of a download: two-space indent, one
    trailing newline (`services/console/src/server.ts`, `/export/chain.json`)."""
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def _identity(crypto, key) -> dict:
    pub = key.public()
    raw = pub.ed_pk.public_bytes(crypto.serialization.Encoding.Raw,
                                 crypto.serialization.PublicFormat.Raw)
    return {
        "alg": SUITE,
        "classical": base64.b64encode(raw).decode(),
        "fingerprint": pub.fingerprint(),
        "pq": base64.b64encode(pub.ml_pk).decode(),
    }


def _resign(crypto, executor, key, entry: dict) -> dict:
    """The anchor entry, signed again by `key`, with everything stored beside
    it made consistent -- a forger who controls the file controls all of it."""
    out = copy.deepcopy(entry)
    signed = out["anchor"]
    body = executor.canon({k: signed[k] for k in ("alg", "heads", "period_end", "v")})
    signed["sig"] = {
        "classical": base64.b64encode(key.ed_sk.sign(body)).decode(),
        "pq": base64.b64encode(
            crypto.ML_DSA_65.sign(key.ml_sk, body, deterministic=True)).decode(),
    }
    out["anchor_body"] = body.decode()
    out["anchor_digest"] = "sha256:" + hashlib.sha256(executor.canon(signed)).hexdigest()
    out["anchor_identity"] = {**_identity(crypto, key),
                              "note": "the forger's own key, written beside the anchor it signed"}
    return out


def _relink(audit, rows: list, start: int) -> None:
    """Recompute every chain hash from `start` on, as a writer rewriting its
    own storage would: the chain stays internally consistent, and only an
    anchor published before the rewrite can tell."""
    for i in range(start, len(rows)):
        prev = rows[i - 1]["chain_hash"] if i > 0 else None
        rows[i]["previous_hash"] = prev
        rows[i]["chain_hash"] = (audit._h(rows[i]["record"]) if rows[i]["seq"] == 0
                                 else audit._h({"prev": prev, "record": rows[i]["record"]}))


def derive(crypto, executor, audit, source_bytes: bytes) -> dict[str, str]:
    """Every corpus file's text, from the source export's bytes."""
    answer = json.loads(source_bytes)["answer"]
    export = {k: v for k, v in answer.items() if k != "outcome"}
    rows = export["chain"]
    rust = {r["seq"]: r["chain_hash"] for r in rows}   # the writer's hashes
    key = crypto.HybridKey(ANCHOR_SEED)
    files: dict[str, str] = {}

    files["anchor-identity.pub"] = _text({
        **_identity(crypto, key),
        "note": ("the audit anchor identity's PUBLIC half, derived from the seed "
                 "services/anchor/tests/wire.rs signs the console fixtures with; "
                 "the copy a customer holds, never read out of an export"),
    })
    files["export.json"] = _text(export)

    # One byte: the hold record's operator, `op-1` -> `op-2`.
    one = copy.deepcopy(export)
    assert one["chain"][2]["record"]["operator"] == "op-1"
    one["chain"][2]["record"]["operator"] = "op-2"
    files["export-one-byte.json"] = _text(one)
    a, b = files["export.json"].encode(), files["export-one-byte.json"].encode()
    assert len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1, "exactly one byte"

    dropped = copy.deepcopy(export)
    dropped["anchors"] = dropped["anchors"][:-1]
    files["export-last-anchor-dropped.json"] = _text(dropped)

    forged = copy.deepcopy(export)
    forged["anchors"][0] = _resign(crypto, executor, crypto.HybridKey(FORGER_SEED),
                                   forged["anchors"][0])
    files["export-forged-anchor.json"] = _text(forged)

    rewritten = copy.deepcopy(export)
    rewritten["chain"][1]["record"]["decision"] = "DENY"
    _relink(audit, rewritten["chain"], 1)
    files["export-rewritten.json"] = _text(rewritten)

    window = copy.deepcopy(export)
    window["chain"] = window["chain"][2:]
    files["export-window.json"] = _text(window)

    # The rest name each refusal once, so the two readers are held to the
    # same NAME for every way a file can break, not only to the same yes/no.
    gap = copy.deepcopy(export)
    del gap["chain"][2]
    files["export-seq-gap.json"] = _text(gap)

    link = copy.deepcopy(export)
    link["chain"][3]["previous_hash"] = link["chain"][1]["chain_hash"]
    files["export-link-broken.json"] = _text(link)

    place = copy.deepcopy(export)
    place["chain"][3]["record"]["seq"] = 4
    files["export-out-of-place.json"] = _text(place)

    # `1.0`, not `1.5`: JavaScript's parser reads `1.0` as the integer 1, so
    # this is the case a reader that looked only at parsed values would hash
    # as `1` -- bytes no writer wrote -- and report as a hash mismatch.
    frac = copy.deepcopy(export)
    frac["chain"][3]["record"]["weight"] = 1.0
    files["export-not-canonical.json"] = _text(frac)

    empty = copy.deepcopy(export)
    empty["chain"] = []
    files["export-empty.json"] = _text(empty)

    suite = copy.deepcopy(export)
    suite["anchors"][0]["anchor"]["alg"] = "ed25519"
    files["export-anchor-suite.json"] = _text(suite)

    def verified(first, last, anchors, through, *, starts_after=None, checked):
        unanchored_from = first if through is None else (through + 1 if through < last else None)
        return {
            "verdict": "verified", "tenant": export["tenant"],
            "first_seq": first, "last_seq": last, "records": last - first + 1,
            "last_chain_hash": rust[last], "starts_after": starts_after,
            "anchors_checked": checked, "anchors": anchors,
            "anchored_through": through, "unanchored_from": unanchored_from,
            "unanchored_count": 0 if unanchored_from is None else last - unanchored_from + 1,
        }

    def anchor(status, placement):
        return {"index": 0, "status": status, "placement": placement, "head_seq": 1,
                "period_end": export["anchors"][0]["anchor"]["period_end"]}

    def refused(name, seq=None, anchor_index=None):
        return {"verdict": "refused", "refusal": name, "seq": seq, "anchor": anchor_index}

    cases = [
        ("the export as downloaded, no anchor key: chained, anchors unchecked",
         "export.json", False, verified(0, 3, [anchor("unchecked", "in_file")], None, checked=False)),
        ("the export as downloaded, with the anchor key: records 0-1 anchored, 2-3 not yet",
         "export.json", True, verified(0, 3, [anchor("verified", "in_file")], 1, checked=True)),
        ("one byte of record 2 flipped", "export-one-byte.json", True,
         refused("ChainHashMismatch", seq=2)),
        ("one byte of record 2 flipped, no anchor key", "export-one-byte.json", False,
         refused("ChainHashMismatch", seq=2)),
        ("the last anchor dropped: chained, nothing anchored", "export-last-anchor-dropped.json",
         True, verified(0, 3, [], None, checked=True)),
        ("an anchor signed by a key the export carries beside it", "export-forged-anchor.json",
         True, refused("AnchorSignatureInvalid", anchor_index=0)),
        ("the same forgery with no anchor key: nothing can tell, so it is unchecked",
         "export-forged-anchor.json", False,
         verified(0, 3, [anchor("unchecked", "in_file")], None, checked=False)),
        ("record 1 rewritten and the chain relinked after it was anchored",
         "export-rewritten.json", True, refused("AnchorHeadMismatch", seq=1, anchor_index=0)),
        ("the rewrite, with no anchor key: the anchor's head still disagrees",
         "export-rewritten.json", False, refused("AnchorHeadMismatch", seq=1, anchor_index=0)),
        ("a window starting at record 2: the anchor at record 1 checks its floor",
         "export-window.json", True,
         verified(2, 3, [anchor("verified", "window_floor")], 1,
                  starts_after=rust[1], checked=True)),
        ("record 2 missing from the middle", "export-seq-gap.json", True,
         refused("ChainSeqGap", seq=3)),
        ("record 3 claims to continue from record 1", "export-link-broken.json", True,
         refused("ChainLinkBroken", seq=3)),
        ("record 3 names position 4", "export-out-of-place.json", True,
         refused("RecordOutOfPlace", seq=3)),
        ("record 3 carries a fraction", "export-not-canonical.json", True,
         refused("RecordNotCanonical", seq=3)),
        ("a file with no records", "export-empty.json", True, refused("ExportEmpty")),
        ("an anchor naming a suite the anchor key is not", "export-anchor-suite.json", True,
         refused("AnchorSuiteNotEnrolled", anchor_index=0)),
    ]
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    files["expected.json"] = _text({
        "provenance": {
            "source": SOURCE_NAME,
            "source_sha256": source_sha,
            "engine_rev": SOURCE_REV,
            "generator": "packages/acp-verify/fixtures/chain-export/gen_chain_corpus.py",
        },
        "anchor_key": "anchor-identity.pub",
        "cases": [{"name": n, "file": f, "with_anchor_key": k, "verdict": v}
                  for n, f, k, v in cases],
    })
    return files


def main() -> int:
    import acp_audit      # the engine's, via PYTHONPATH -- never a copy
    import acp_crypto
    import acp_executor

    with open(SOURCE, "rb") as f:
        source_bytes = f.read()
    files = derive(acp_crypto, acp_executor, acp_audit, source_bytes)
    if "--check" in sys.argv[1:]:
        bad = []
        for name, text in files.items():
            path = os.path.join(HERE, name)
            on_disk = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if on_disk != text:
                bad.append(name)
        if bad:
            print(f"chain corpus drifted from its source: {', '.join(bad)}", file=sys.stderr)
            return 1
        print(f"chain corpus: {len(files)} files re-derive from {SOURCE_NAME}")
        return 0
    for name, text in files.items():
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            f.write(text)
    print(f"wrote {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
