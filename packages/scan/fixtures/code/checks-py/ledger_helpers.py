"""Application helpers two calls away from a tool."""
from billing_tools import close_account


def settle(invoice_id):
    return _post(invoice_id)


def _post(invoice_id):
    return close_account(invoice_id)
