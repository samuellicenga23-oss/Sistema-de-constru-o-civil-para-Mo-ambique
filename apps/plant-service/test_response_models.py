import unittest

from main import OpeningOut, RoomOut, SlabOut


class ResponseModelTests(unittest.TestCase):
    def test_room_keeps_real_perimeter(self):
        room = RoomOut(name="Sala", number=None, areaM2=20, page=1, floor="Piso Térreo", perimeterM=18)
        self.assertEqual(room.perimeterM, 18)

    def test_slab_and_opening_fields_are_not_mixed(self):
        slab = SlabOut(floor="Cobertura", thicknessCm=15, layers=["inferior", "superior"], pages=[8, 9])
        opening = OpeningOut(
            kind="janela",
            code="J01",
            widthM=1.5,
            heightM=1.2,
            sillHeightM=0.9,
            quantity=2,
            floor="Piso Térreo",
            location="exterior",
            material="Alumínio",
            page=4,
            confidence=0.95,
            source="quadro",
            needsConfirmation=False,
        )
        self.assertEqual(slab.thicknessCm, 15)
        self.assertEqual(opening.quantity, 2)


if __name__ == "__main__":
    unittest.main()
