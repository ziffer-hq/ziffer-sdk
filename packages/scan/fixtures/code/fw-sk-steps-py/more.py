from semantic_kernel.functions import kernel_function

from base import NotifyStep


class NotifyShelvedStep(NotifyStep):
    @kernel_function(name="NotifyShelved")
    async def notify_shelved(self, isbn: str) -> str:
        return isbn
