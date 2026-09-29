#!/usr/bin/env python3
"""Regenerate canon_vectors.json from the ENGINE's own canon at the pin.

Run with the engine reference on the path:

    PYTHONPATH=$ACP_REPO_PATH/reference/src python3 gen_canon_vectors.py

Every `canonical_utf8` in the fixture is the output of the engine's
`acp_executor.canon()` -- imported and executed, never transcribed -- so the
fixture cannot drift from the engine without a re-run, and a re-run against a
different engine rev must update `source_rev` below. tools/check-verify-mirror.py
re-derives every case at the pin and refuses a fixture this script's output
would not reproduce.

Values are restricted to what JavaScript can represent losslessly (safe
integers, no floats): a case outside that domain would make the TS side compare
against bytes it can never produce. The TS canon REFUSES that domain instead
(AT-8a), and those refusals are tested in TS directly, not carried here.
"""
import json
import os
import sys

import acp_executor  # the engine's, via PYTHONPATH -- never a copy

SOURCE_REV = "0ce0567bec3ee9d8c2b58d8c26c1ec83c4782f72"

CASES = [
    ("empty_object", {}),
    ("empty_array", []),
    ("scalars", {"t": True, "f": False, "n": None, "i": 0, "neg": -1, "s": "x"}),
    ("keys_sorted_at_every_depth", {"b": [{"z": 1, "y": 2}], "a": {"d": 2, "c": 3}}),
    ("no_whitespace", {"a": [1, 2, {"k": "v"}]}),
    ("raw_utf8_like_ensure_ascii_false", {"k": "é", "café": "日本語"}),
    # The eight escapes Python, serde_json and JSON.stringify must agree on:
    # the five shorthands, the quote, the backslash, and a bare control char.
    ("control_chars_escaped_identically", {"esc": "\b\t\n\f\r\"\\"}),
    # U+10000 encodes as a surrogate pair in UTF-16, so JS default string
    # comparison puts it BEFORE U+FFFD; code-point order puts it after.
    # This case is what forces the TS canon to sort by code point.
    ("astral_keys_sort_by_code_point_not_utf16_unit",
     {"\U00010000": "astral", "�": "bmp"}),
    ("astral_value_raw", {"pair": "a\U0001f41bb"}),
    ("integer_domain_safe", {"max_safe": 9007199254740991, "min_safe": -9007199254740991}),
    ("nested_arrays", [[1, [2, [3]]], {"a": [True, None]}]),
    ("key_order_is_byte_order", {"Z": 1, "a": 2, "é": 3, "0": 4}),
    ("receipt_shaped_body", {
        "alg": "hybrid-ed25519-mldsa65", "decision": "ALLOW",
        "expires_at": "2026-09-02T10:01:00Z", "issued_at": "2026-09-02T10:00:00Z",
        "nonce": "b64:AAAAAAAAAAAAAAAAAAAAAA==",
        "proposal_hash": "sha256:" + "0" * 64,
        "receipt_version": 3, "tenant_id": "t1", "operator": "op-1"}),
]


def main() -> None:
    out = {
        "provenance": {
            "derived_from": "reference/src/acp_executor.py::canon "
                            "(imported and executed by gen_canon_vectors.py, not transcribed)",
            "source_rev": SOURCE_REV,
            "rule": 'json.dumps(obj, sort_keys=True, separators=(",", ":"), '
                    'ensure_ascii=False).encode("utf-8")',
            "note": "Each canonical_utf8 is the engine reference's canon() output over `value`, "
                    "decoded as UTF-8. tools/check-verify-mirror.py re-derives every case against "
                    "the engine at the pin; packages/acp-verify tests assert the TS canon "
                    "reproduces the same bytes.",
        },
        "cases": [
            {"name": n, "value": v, "canonical_utf8": acp_executor.canon(v).decode("utf-8")}
            for n, v in CASES
        ],
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "canon_vectors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {path}: {len(out['cases'])} cases")


if __name__ == "__main__":
    sys.exit(main())
