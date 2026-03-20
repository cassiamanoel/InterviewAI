import pytest
from unittest.mock import patch, MagicMock

def test_upload_cv(client):
    file_content = b"Fake PDF Data"
    
    # We patch the static methods in CVService
    with patch("app.services.cv_service.CVService.extract_text_from_pdf") as mock_extract:
        mock_extract.return_value = "Parsed Text"
        
        with patch("app.services.cv_service.CVService.save_cv") as mock_save:
            mock_cv = MagicMock()
            mock_cv.id = "mock-uuid"
            mock_save.return_value = mock_cv
            
            with patch("app.services.cv_service.CVService.index_cv_to_qdrant") as mock_index:
                mock_index.return_value = {"chunks": 5}
                
                files = {"file": ("resume.pdf", file_content, "application/pdf")}
                response = client.post("/cv/upload", files=files)
                
                assert response.status_code == 200
                assert response.json()["chunks_indexed"] == 5

def test_upload_cv_bad_type(client):
    file_content = b"Fake Text Data"
    files = {"file": ("resume.txt", file_content, "text/plain")}
    response = client.post("/cv/upload", files=files)
    assert response.status_code == 400
