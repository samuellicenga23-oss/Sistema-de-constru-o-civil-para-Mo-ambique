"""
Cascata de leitura de plantas — um nível de cada vez.

Regra: tentar Nível 1; se passar, fica. Só então Nível 2, etc.
Isto evita misturar métodos de gabinetes diferentes e inventar dados
quando o PDF já trouxe a resposta fiável.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass
class CascadeStep:
    level: int
    name: str
    passed: bool
    count: int
    detail: str = ""


@dataclass
class CascadeResult:
    domain: str
    steps: list[CascadeStep]
    chosen_level: int | None

    @property
    def summary(self) -> str:
        if self.chosen_level is None:
            tried = ", ".join(f"L{s.level}:{s.name}" for s in self.steps)
            return f"{self.domain}: nenhum nível passou ({tried})"
        step = next(s for s in self.steps if s.level == self.chosen_level)
        return f"{self.domain}: L{step.level} «{step.name}» ({step.count})"


def run_cascade(
    domain: str,
    levels: list[tuple[int, str, Callable[[], tuple[list, str]]]],
    *,
    min_count: int = 1,
) -> tuple[list, CascadeResult]:
    """
    Executa níveis em ordem. O primeiro cujo len(items) >= min_count ganha.
    Níveis seguintes não correm.
    """
    steps: list[CascadeStep] = []
    for level, name, producer in levels:
        items, detail = producer()
        count = len(items)
        passed = count >= min_count
        steps.append(CascadeStep(level=level, name=name, passed=passed, count=count, detail=detail))
        if passed:
            return items, CascadeResult(domain=domain, steps=steps, chosen_level=level)
    return [], CascadeResult(domain=domain, steps=steps, chosen_level=None)
