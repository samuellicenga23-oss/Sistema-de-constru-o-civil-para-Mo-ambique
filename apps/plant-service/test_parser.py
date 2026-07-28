import unittest

import fitz

from parser import (
    Room,
    dedupe_rooms,
    extract_room_list_fallback,
    extract_rooms,
    extract_rooms_spatial,
    parse_pdf,
)


class RoomExtractionTests(unittest.TestCase):
    def test_accepts_mixed_case_and_common_area_labels(self):
        text = """Planta Cotada Piso Térreo
Suite 2
CA: 22,400 m2
Cozinha Área: 16.00 m²
Quarto 1
S = 12,35 m2
"""
        rooms = extract_rooms(text, 1)

        self.assertEqual(
            [(room.name, room.number, room.area_m2) for room in rooms],
            [("Suite", "2", 22.4), ("Cozinha", None, 16.0), ("Quarto", "1", 12.35)],
        )

    def test_uses_geometry_when_pdf_text_order_is_not_semantic(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=400)
        # Inserida primeiro de propósito: na ordem interna do PDF a área vem antes do nome.
        page.insert_text((100, 130), "12,50 m2", fontsize=10)
        page.insert_text((100, 110), "Cozinha", fontsize=10)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Cozinha")
        self.assertEqual(rooms[0].area_m2, 12.5)
        doc.close()

    def test_duplicate_sheets_do_not_remove_legitimate_equal_rooms(self):
        page_one = [
            Room("Sala", None, 24.0, 1, "Piso Térreo"),
            Room("Cozinha", None, 12.0, 1, "Piso Térreo"),
            Room("W.C", None, 4.0, 1, "Piso Térreo"),
            Room("W.C", None, 4.0, 1, "Piso Térreo"),
        ]
        page_two = [
            Room("Sala", None, 24.0, 2, "Piso Térreo"),
            Room("Cozinha", None, 12.0, 2, "Piso Térreo"),
            Room("W.C", None, 4.0, 2, "Piso Térreo"),
            Room("W.C", None, 4.0, 2, "Piso Térreo"),
        ]

        rooms = dedupe_rooms(page_one + page_two, {1: 3, 2: 4})

        self.assertEqual(len(rooms), 4)
        self.assertEqual(sum(room.name == "W.C" for room in rooms), 2)
        self.assertTrue(all(room.page == 2 for room in rooms))

    def test_room_number_is_scoped_by_room_type(self):
        rooms = dedupe_rooms(
            [
                Room("Quarto", "1", 20.0, 1, "Piso Térreo"),
                Room("Suite", "1", 22.0, 1, "Piso Térreo"),
            ]
        )
        self.assertEqual({(room.name, room.number) for room in rooms}, {("Quarto", "1"), ("Suite", "1")})

    def test_uses_explicit_room_list_only_as_supported_fallback(self):
        rooms = extract_room_list_fallback(
            "• Sala de estar 42,20 m²;\n• Cozinha 16.00 m²;\nTexto geral 208,22 m².",
            5,
        )
        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Sala de estar", 42.2), ("Cozinha", 16.0)])

    def test_single_storey_document_assigns_ground_floor_and_skips_furniture_plan(self):
        doc = fitz.open()
        description = doc.new_page()
        description.insert_text((50, 70), "Moradia de piso único")
        floor_plan = doc.new_page()
        floor_plan.insert_text((50, 50), "Nome do Desenho: Planta de Piso")
        floor_plan.insert_text((100, 100), "Sala de Estar")
        floor_plan.insert_text((100, 120), "CA: 24,00 m2")
        furniture = doc.new_page()
        furniture.insert_text((50, 50), "Nome do Desenho: Planta Mobilia")
        furniture.insert_text((100, 100), "Sala de Estar")
        furniture.insert_text((100, 120), "CA: 24,00 m2")
        payload = doc.tobytes()
        doc.close()

        result = parse_pdf(payload)

        self.assertEqual(len(result.rooms), 1)
        self.assertEqual(result.rooms[0].name, "Sala de Estar")
        self.assertEqual(result.rooms[0].floor, "Piso Térreo")


if __name__ == "__main__":
    unittest.main()
