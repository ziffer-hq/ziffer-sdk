"""The one dispatcher and its callers: one asks a person first, one does not, one writes a timestamp after."""
import time

from billing_tools import archive_notes, close_account


def dispatch(tool_name, args):
    if tool_name == "close_account":
        return close_account(**args)
    elif tool_name == "archive_notes":
        return archive_notes(**args)
    raise ValueError(tool_name)


def approve_and_run(request):
    if not request.confirmed:
        raise PermissionError("ask the account owner first")
    return dispatch(request.tool_name, request.args)


def model_turn(block, session):
    out = dispatch(block.name, block.input)
    confirmed_at = time.time()
    if session.confirmed:
        session.log(confirmed_at)
    return out
