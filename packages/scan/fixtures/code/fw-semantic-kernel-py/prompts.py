"""Prompt functions loaded from a directory: named, not read."""
from semantic_kernel import Kernel

kernel = Kernel()
kernel.add_plugin(parent_directory="prompt_plugins", plugin_name="summaries")

from semantic_kernel.core_plugins import TimePlugin

kernel.add_plugin(TimePlugin(), plugin_name="time")
