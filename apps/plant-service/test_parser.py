import unittest

import fitz

from parser import (
    Room,
    PageClassification,
    build_document_analysis,
    classify_document_pages,
    dedupe_rooms,
    extract_room_list_fallback,
    extract_rooms,
    extract_rooms_spatial,
    extract_opening_schedule,
    detect_plan_type,
    is_room_area_page,
    parse_pdf,
    Slab,
    summarise_slabs,
)


class RoomExtractionTests(unittest.TestCase):
    def test_extracts_door_and_window_schedule_with_dimensions_and_quantity(self):
        text = """PLANTA COTADA PISO T\u00c9RREO
J01 Janela de alum\u00ednio 1,50 x 1,20 m 4
P02 Porta interior de madeira 0,90 x 2,10 m 6
"""
        openings = extract_opening_schedule(text, 7)
        self.assertEqual(len(openings), 2)
        # O código é normalizado com traço (J01 -> J-01) para casar de forma consistente,
        # seja qual for o formato usado na planta de origem (J01, J-01 ou J.01).
        self.assertEqual((openings[0].kind, openings[0].code, openings[0].quantity), ("janela", "J-01", 4))
        self.assertEqual((openings[0].width_m, openings[0].height_m, openings[0].material), (1.5, 1.2, "Alum\u00ednio"))
        self.assertEqual((openings[1].kind, openings[1].location, openings[1].quantity), ("porta", "interior", 6))

    def test_groups_slab_layers_but_keeps_different_floor_thicknesses(self):
        slabs = summarise_slabs([
            Slab("1º Piso", "inferior", 15, 12),
            Slab("1º Piso", "superior", 15, 13),
            Slab("Cobertura", "inferior", 12, 14),
            Slab("Cobertura", "superior", 12, 15),
        ])

        self.assertEqual(len(slabs), 2)
        self.assertEqual([(slab.floor, slab.thickness_cm) for slab in slabs], [("1º Piso", 15), ("Cobertura", 12)])
        self.assertEqual(slabs[0].layers, ["inferior", "superior"])

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

    def test_normalises_common_room_name_typos_from_drawings(self):
        rooms = extract_rooms("Garragem\nA: 47,52 m2\nQ.BANHIO\nA: 3,90 m2", 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Garagem", 47.52), ("Q. Banho", 3.9)])

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

    def test_excludes_satellite_and_misspelled_site_plan_sheets(self):
        satellite = "Planta de Piso\nConteúdo: IMAGEM SATÉLITE"
        site_plan = "Planta de Piso\nConteúdo: PLANTA DE IMPLATAÇÃO"

        self.assertEqual(detect_plan_type(satellite), "imagem_satelite")
        self.assertEqual(detect_plan_type(site_plan), "implantacao")
        self.assertFalse(is_room_area_page(satellite))
        self.assertFalse(is_room_area_page(site_plan))

    def test_ignores_room_tags_hidden_by_published_pdf_mask(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=400)
        page.insert_text((100, 110), "Cozinha", fontsize=10)
        page.insert_text((100, 130), "12,50 m2", fontsize=10)
        page.insert_text((360, 110), "Quarto", fontsize=10)
        page.insert_text((360, 130), "18,00 m2", fontsize=10)
        page.draw_rect(fitz.Rect(345, 90, 440, 145), color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Cozinha", 12.5)])
        doc.close()

    def test_prefers_dimensioned_view_when_two_views_share_one_sheet(self):
        doc = fitz.open()
        page = doc.new_page(width=700, height=400)
        for x in (120, 470):
            page.insert_text((x, 100), "Cozinha", fontsize=10)
            page.insert_text((x, 120), "12,50 m2", fontsize=10)
            page.insert_text((x, 160), "W.C", fontsize=10)
            page.insert_text((x, 180), "4,00 m2", fontsize=10)
        page.insert_text((110, 350), "PLANTA DE PISO", fontsize=12)
        page.insert_text((455, 350), "PLANTA COTADA", fontsize=12)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Cozinha", 12.5), ("W.C", 4.0)])
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

    def test_separates_complete_project_even_with_wrong_hydro_stamp(self):
        texts = [
            "Projecto Arquitetónico\nPlanta Cotada Piso Térreo",
            "Especialidade: ARQUITECTURA\nPlanta Cotada Piso Superior",
            "Projecto Hidrossanitário\nEspecialidade: ARQUITECTURA\nHID.1\nABASTECIMENTO DE ÁGUA",
            "Especialidade: ARQUITECTURA\nPlanta de Piso\nHID.2\nESPECIFICAÇÕES TÉCNICAS",
            "Projecto Estrutural\nEspecialidade: ESTRUTURA\nPLANTA DE FUNDAÇÃO",
        ]

        analysis = build_document_analysis(classify_document_pages(texts))

        self.assertTrue(analysis.is_multi_discipline)
        self.assertEqual(
            [(section.discipline, section.start_page, section.end_page) for section in analysis.sections],
            [("arquitectura", 1, 2), ("hidrossanitario", 3, 4), ("estrutura", 5, 5)],
        )

    def test_blocks_combination_when_discipline_identity_conflicts(self):
        texts = [
            "Projecto Arquitectónico\nProprietário: Fernando Gore Chaera\nDistrito: Chimoio\nPlanta cotada",
            "Projecto Estrutural\nProprietário: Edson Nhapulo\nDistrito: Marracuene\nPlanta de fundação",
        ]
        classifications = [
            PageClassification(page=1, discipline="arquitectura", confidence=0.95, evidence=["planta cotada"]),
            PageClassification(page=2, discipline="estrutura", confidence=0.95, evidence=["planta de fundação"]),
        ]

        analysis = build_document_analysis(classifications, texts)

        self.assertTrue(analysis.requires_identity_confirmation)
        self.assertEqual({conflict.field for conflict in analysis.identity_conflicts}, {"owner", "location"})
        self.assertEqual(analysis.sections[0].identity.owner, "Fernando Gore Chaera")
        self.assertEqual(analysis.sections[1].identity.location, "Marracuene")

    def test_combines_disciplines_when_identity_is_consistent(self):
        texts = [
            "Projecto Arquitectónico\nCliente: Empresa ABC, Lda\nLocal: Matola\nPlanta cotada",
            "Projecto Estrutural\nCliente: Empresa ABC Lda\nLocal: Matola\nPlanta de fundação",
        ]
        classifications = [
            PageClassification(page=1, discipline="arquitectura", confidence=0.95),
            PageClassification(page=2, discipline="estrutura", confidence=0.95),
        ]

        analysis = build_document_analysis(classifications, texts)

        self.assertFalse(analysis.requires_identity_confirmation)
        self.assertEqual(analysis.identity_conflicts, [])

    def test_uses_extracted_content_when_sheet_has_no_standard_title(self):
        classifications = classify_document_pages(
            ["Gabinete XPTO\nFolha 01", "Desenho sem carimbo normalizado", "Notas gerais"],
            {2: [("arquitectura", 7, "compartimentos e áreas reconhecidos")]},
        )

        self.assertEqual([page.discipline for page in classifications], ["arquitectura"] * 3)
        self.assertIn("compartimentos e áreas reconhecidos", classifications[1].evidence)

    def test_duplicate_general_plan_inherits_floor_from_dimensioned_plan(self):
        rooms = dedupe_rooms(
            [
                Room("Sala", None, 24.0, 1, None),
                Room("Cozinha", None, 12.0, 1, None),
                Room("W.C", None, 4.0, 1, None),
                Room("Sala", None, 24.0, 2, "Piso Térreo"),
                Room("Cozinha", None, 12.0, 2, "Piso Térreo"),
                Room("W.C", None, 4.0, 2, "Piso Térreo"),
            ],
            {1: 3, 2: 4},
        )

        self.assertEqual(len(rooms), 3)
        self.assertTrue(all(room.floor == "Piso Térreo" for room in rooms))

    def test_reports_configured_terms_found_in_complete_project(self):
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 70), "Projecto de seguranca: rede CCTV e central de incendio")
        payload = doc.tobytes()
        doc.close()

        result = parse_pdf(payload, detection_tags=["cctv", "elevador", "incendio"])

        # matched_tags também acumula evidência de diagnóstico da cascata (visível no health de
        # parse) — só confirmamos aqui que as tags configuradas realmente encontradas estão lá,
        # não a lista exacta (essa evidência varia consoante o que a cascata encontrar/não encontrar).
        self.assertIn("cctv", result.document_analysis.matched_tags)
        self.assertIn("incendio", result.document_analysis.matched_tags)
        self.assertNotIn("elevador", result.document_analysis.matched_tags)


if __name__ == "__main__":
    unittest.main()
