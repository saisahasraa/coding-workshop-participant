"""
File storage for attachments: short-lived signed links to a private S3 bucket.

The browser uploads to and downloads from S3 directly; the API only signs the links, so file bytes never
pass through the Lambda. ``boto3`` is part of the Lambda runtime and is imported on first use.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import ENV
from app.http import ApiError

LINK_SECONDS = 300


def is_configured() -> bool:
    """Whether a bucket is configured for this environment."""
    return bool(ENV.attachments_bucket)


@lru_cache(maxsize=1)
def _client():
    import boto3  # pylint: disable=import-outside-toplevel
    from botocore.config import Config  # pylint: disable=import-outside-toplevel

    # Locally the links must point at an address the browser can reach (LocalStack on localhost).
    style = {"addressing_style": "path"} if ENV.s3_public_endpoint else {}
    # Links must name the bucket's regional address. boto3 otherwise builds them for the global
    # s3.amazonaws.com host, which routes to us-east-1 and rejects a bucket in any other region.
    region = ENV.attachments_region or None
    endpoint = ENV.s3_public_endpoint or (f"https://s3.{region}.amazonaws.com" if region else None)
    return boto3.client("s3", region_name=region, endpoint_url=endpoint,
                        config=Config(signature_version="s3v4", s3=style))


def _require() -> None:
    if not is_configured():
        raise ApiError(503, "storage_unavailable", "File storage is not configured in this environment")


def upload_link(key: str, content_type: str) -> dict:
    """Where and how the browser should PUT the file."""
    _require()
    url = _client().generate_presigned_url(
        "put_object", Params={"Bucket": ENV.attachments_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=LINK_SECONDS)
    return {"url": url, "method": "PUT", "headers": {"Content-Type": content_type}, "expires_in": LINK_SECONDS}


def download_link(key: str, filename: str, content_type: str, inline: bool) -> str:
    """A link that serves the file under its original name (shown in the browser when ``inline``)."""
    _require()
    safe = filename.replace('"', "'")
    disposition = f'{"inline" if inline else "attachment"}; filename="{safe}"'
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": ENV.attachments_bucket, "Key": key, "ResponseContentDisposition": disposition,
                "ResponseContentType": content_type},
        ExpiresIn=LINK_SECONDS)
