"""Testes do assistente Ollama (sem rede — só parsing e selecção de páginas)."""
import os
import unittest
from unittest import mock

# Desliga IA por omissão nos testes de import do parser; ligamos só onde precisamos.
os.environ["PLANT_AI_ENABLED"] = "0"

from ai_assist import parse_ai_payload, select_ai_pages, should_use_ai  # noqa: E402


class AiAssistTests(unittest.TestCase):
    def test_parse_ai_payload_rooms_and_openings(self):
        rooms, openings = parse_ai_payload(
            {
                "rooms": [
                    {"name": "Sala de estar", "areaM2": 22.5, "floor": "Piso Térreo"},
                    {"nome": "WC", "area": "4,2"},
                    {"name": "Inválida", "areaM2": -1},
                ],
                "openings": [
                    {"kind": "porta", "code": "P01", "widthM": 0.9, "heightM": 2.1, "quantity": 1, "location": "interior"},
                    {"tipo": "janela", "largura": "1,50", "altura": "1.20", "quantidade": 2},
                    {"kind": "porta", "widthM": 99},
                ],
            },
            page=3,
        )
        self.assertEqual(len(rooms), 2)
        self.assertEqual(rooms[0].name, "Sala de estar")
        self.assertEqual(rooms[0].area_m2, 22.5)
        self.assertEqual(rooms[1].area_m2, 4.2)
        self.assertEqual(len(openings), 3)
        self.assertEqual(openings[0].source, "ia")
        self.assertTrue(openings[0].needs_confirmation)
        self.assertEqual(openings[1].kind, "janela")
        self.assertEqual(openings[1].quantity, 2)
        self.assertAlmostEqual(openings[1].width_m or 0, 1.5)
        self.assertIsNone(openings[2].width_m)

    def test_select_ai_pages_prefers_architecture_without_rooms(self):
        pages = select_ai_pages(
            [
                "capa do projecto",
                "PLANTA COTADA Piso Térreo Sala 12 m² Escala 1:100",
                "memória descritiva longa sem área útil",
                "PLANTA Piso Térreo quadro de portas e janelas Escala 1:50",
            ],
            architecture_pages={2, 4},
            pages_with_rooms={2},
            max_pages=3,
        )
        self.assertEqual(pages, [4])

    def test_should_use_ai_when_no_rooms(self):
        with mock.patch("ai_assist.PLANT_AI_ENABLED", True), mock.patch("ai_assist.PLANT_AI_MIN_ROOMS", 1):
            self.assertTrue(should_use_ai(0, 0, [1, 2]))
            self.assertFalse(should_use_ai(5, 3, [1]))
            self.assertTrue(should_use_ai(2, 0, [1]))


if __name__ == "__main__":
    unittest.main()
