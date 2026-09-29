from enum import Enum

from pydantic import BaseModel
from semantic_kernel.functions import kernel_function
from semantic_kernel.processes.kernel_process import KernelProcessStep, KernelProcessStepContext


class ShelvingState(BaseModel):
    shelved: int = 0


class ShelveStep(KernelProcessStep[ShelvingState]):
    """A step of a process: the process runs it on an event; no model is offered it."""

    class Functions(Enum):
        Shelve = "Shelve"

    @kernel_function(name=Functions.Shelve)
    async def shelve(self, context: KernelProcessStepContext, isbn: str) -> None:
        await context.emit_event(process_event="Shelved", data=isbn)
