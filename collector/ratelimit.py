"""Limiteur de débit à fenêtres glissantes.

Riot applique ses limites par valeur de routage (euw1, europe...) :
20 requêtes / 1 s et 100 requêtes / 2 min pour une Personal API Key.
On garde une petite marge (19 et 95) pour ne jamais recevoir de 429.
"""

import time
from collections import deque
from typing import Callable

DEFAULT_LIMITS = ((19, 1.0), (95, 120.0))


class RateLimiter:
    def __init__(
        self,
        limits=DEFAULT_LIMITS,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._windows = [(count, seconds, deque()) for count, seconds in limits]
        self._clock = clock
        self._sleep = sleep
        self._blocked_until = 0.0

    def acquire(self) -> None:
        """Bloque jusqu'à ce qu'une requête puisse partir, puis la comptabilise."""
        while True:
            now = self._clock()
            wait = max(0.0, self._blocked_until - now)
            for count, seconds, stamps in self._windows:
                while stamps and now - stamps[0] >= seconds:
                    stamps.popleft()
                if len(stamps) >= count:
                    wait = max(wait, seconds - (now - stamps[0]))
            if wait <= 0:
                for _, _, stamps in self._windows:
                    stamps.append(now)
                return
            self._sleep(wait + 0.05)

    def pause(self, seconds: float) -> None:
        """Après un 429, plus aucune requête pendant `seconds`."""
        self._blocked_until = max(self._blocked_until, self._clock() + seconds)
