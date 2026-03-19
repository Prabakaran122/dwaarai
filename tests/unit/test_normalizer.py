import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'services', 'anpr-service'))
from normalizer import normalize_plate


class TestNormalizePlate:
    def test_standard_plate(self):
        assert normalize_plate("KA 05 MF 1234") == "KA05MF1234"

    def test_already_normalized(self):
        assert normalize_plate("KA05MF1234") == "KA05MF1234"

    def test_bh_series(self):
        assert normalize_plate("24BH1234AA") == "24BH1234AA"

    def test_invalid_plate(self):
        assert normalize_plate("HELLO") is None

    def test_lowercase_normalized(self):
        assert normalize_plate("ka05mf1234") == "KA05MF1234"

    def test_short_district_code(self):
        assert normalize_plate("KA05F1234") == "KA05F1234"

    def test_special_chars_removed(self):
        assert normalize_plate("KA-05-MF-1234") == "KA05MF1234"
