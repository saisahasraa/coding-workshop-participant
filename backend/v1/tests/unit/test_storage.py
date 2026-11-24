"""Signed links: what gets signed, without talking to S3."""

import sys
import types

import pytest

from app import storage
from app.http import ApiError


@pytest.fixture
def fake_s3(monkeypatch):
    calls = []

    class Client:
        def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803 - boto3's own argument names
            calls.append((operation, Params, ExpiresIn))
            return f"https://signed/{Params['Key']}"

    created = {}
    boto3 = types.SimpleNamespace(client=lambda name, **kwargs: created.update(name=name, **kwargs) or Client())
    config = types.SimpleNamespace(Config=lambda **kwargs: kwargs)
    monkeypatch.setitem(sys.modules, "boto3", boto3)
    monkeypatch.setitem(sys.modules, "botocore", types.SimpleNamespace(config=config))
    monkeypatch.setitem(sys.modules, "botocore.config", config)
    storage._client.cache_clear()  # noqa: SLF001
    yield calls, created
    storage._client.cache_clear()  # noqa: SLF001


def _env(monkeypatch, bucket="files", endpoint=""):
    monkeypatch.setattr(storage, "ENV", types.SimpleNamespace(attachments_bucket=bucket, s3_public_endpoint=endpoint))


def test_upload_link_binds_the_content_type(monkeypatch, fake_s3):
    calls, created = fake_s3
    _env(monkeypatch)
    link = storage.upload_link("deliverables/1/abc/a.png", "image/png")
    assert link == {"url": "https://signed/deliverables/1/abc/a.png", "method": "PUT",
                    "headers": {"Content-Type": "image/png"}, "expires_in": 300}
    assert calls[0] == ("put_object", {"Bucket": "files", "Key": "deliverables/1/abc/a.png",
                                       "ContentType": "image/png"}, 300)
    assert created["endpoint_url"] is None and created["config"]["s3"] == {}


def test_download_link_names_the_file_and_only_inlines_when_asked(monkeypatch, fake_s3):
    calls, _ = fake_s3
    _env(monkeypatch)
    storage.download_link("k", 'my "plan".pdf', "application/pdf", inline=True)
    storage.download_link("k", "page.html", "text/html", inline=False)
    assert calls[0][1]["ResponseContentDisposition"] == "inline; filename=\"my 'plan'.pdf\""
    assert calls[1][1]["ResponseContentDisposition"] == 'attachment; filename="page.html"'
    assert calls[1][1]["ResponseContentType"] == "text/html"


def test_local_links_use_the_browser_reachable_endpoint(monkeypatch, fake_s3):
    _, created = fake_s3
    _env(monkeypatch, endpoint="http://localhost:4566")
    storage.upload_link("k", "text/plain")
    assert created["endpoint_url"] == "http://localhost:4566"
    assert created["config"]["s3"] == {"addressing_style": "path"}


def test_no_bucket_means_no_links(monkeypatch):
    _env(monkeypatch, bucket="")
    assert storage.is_configured() is False
    with pytest.raises(ApiError) as error:
        storage.upload_link("k", "text/plain")
    assert error.value.status == 503
    with pytest.raises(ApiError):
        storage.download_link("k", "f", "text/plain", inline=False)
