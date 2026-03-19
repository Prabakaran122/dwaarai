import pytest


class TestGPIOMock:
    def test_setup_and_output_high(self):
        from edge.emulators import gpio_mock as GPIO
        GPIO._pins.clear()
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(17, GPIO.OUT, initial=GPIO.LOW)
        assert GPIO.pin_state(17) == GPIO.LOW
        GPIO.output(17, GPIO.HIGH)
        assert GPIO.pin_state(17) == GPIO.HIGH

    def test_cleanup_clears_pins(self):
        from edge.emulators import gpio_mock as GPIO
        GPIO.setup(17, GPIO.OUT)
        GPIO.cleanup()
        assert GPIO.all_pins() == {}


class TestRFIDMock:
    def test_tap_calls_callback_with_uid_hash(self):
        from edge.emulators.rfid_mock import RFIDMock, _hash, TEST_CARDS
        events = []
        mock = RFIDMock(on_tap_callback=lambda e: events.append(e))
        mock.tap("RESIDENT_301")
        assert len(events) == 1
        assert events[0]["uid_hash"] == _hash(TEST_CARDS["RESIDENT_301"]["uid"])

    def test_unknown_card_key_exists(self):
        from edge.emulators.rfid_mock import TEST_CARDS
        assert "UNKNOWN" in TEST_CARDS
        assert "BLACKLISTED" in TEST_CARDS


class TestCameraMock:
    def test_init_loads_images(self, tmp_path):
        img_path = tmp_path / "KA05MF1234.jpg"
        img_path.write_bytes(b'\xff\xd8\xff\xe0' + b'\x00' * 100)
        from edge.emulators.camera_mock import CameraMock
        cam = CameraMock(anpr_url="http://localhost:8001",
                         plates_dir=str(tmp_path), interval=1.0)
        assert len(cam._images) == 1

    def test_init_no_images_raises(self, tmp_path):
        from edge.emulators.camera_mock import CameraMock
        with pytest.raises(FileNotFoundError):
            CameraMock(anpr_url="http://localhost:8001",
                       plates_dir=str(tmp_path), interval=1.0)
