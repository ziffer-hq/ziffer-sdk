from semantic_kernel.functions import kernel_function
from semantic_kernel.processes.kernel_process import KernelProcessStep, KernelProcessStepContext


class NotifyStep(KernelProcessStep):
    """The application's own base step: its subclasses are steps too."""

    @kernel_function
    async def notify(self, context: KernelProcessStepContext, note: str) -> None:
        await context.emit_event(process_event="Notified", data=note)
