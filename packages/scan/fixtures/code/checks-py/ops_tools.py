"""A tool grouped on a class, reaching another tool through a function called by the class's name."""
from langchain_core.tools import tool

from billing_tools import close_account


class OpsTools:

    @tool("Rotate keys")
    def rotate_keys(account_id):
        """Rotate the keys of an account."""
        return OpsTools.revoke(account_id)

    def revoke(account_id):
        return close_account(account_id)
