import pytest, time
from unittest.mock import patch


class TestOfflineQueue:
    def test_enqueue_and_count(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        assert oq.pending_count() == 1

    def test_sync_clears_queue(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        with patch("requests.post") as mp:
            mp.return_value.status_code = 200
            synced = oq.sync("http://localhost:3000/api/v1", "test-token")
        assert synced == 1
        assert oq.pending_count() == 0

    def test_sync_failure_keeps_queue(self, tmp_path):
        from edge.offline_queue import OfflineQueue
        oq = OfflineQueue(str(tmp_path / "q.db"))
        oq.enqueue({"detection_method": "anpr", "raw_value": "KA05MF1234", "event_ts": time.time()})
        with patch("requests.post", side_effect=Exception("network error")):
            synced = oq.sync("http://localhost:3000/api/v1", "test-token")
        assert synced == 0
        assert oq.pending_count() == 1
