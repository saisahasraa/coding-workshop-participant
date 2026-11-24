resource "aws_s3_bucket" "hot_reload" {
  count         = data.aws_caller_identity.this.id == "000000000000" ? 1 : 0
  bucket        = "hot-reload"
  force_destroy = true

  lifecycle {
    prevent_destroy = false
  }

  tags = local.app_tags
}

resource "aws_s3_bucket" "this" {
  bucket        = format("%s-website-%s", var.aws_project, local.app_id)
  force_destroy = true

  lifecycle {
    prevent_destroy = false
  }

  tags = local.app_tags
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "this" {
  bucket = aws_s3_bucket.this.id
  acl    = "private"

  depends_on = [aws_s3_bucket_ownership_controls.this]
}

resource "aws_s3_bucket_website_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

# Private bucket for files attached to comments. Browsers upload and download through short-lived
# signed links issued by the API, so nothing in it is public.
resource "aws_s3_bucket" "attachments" {
  bucket        = format("%s-attachments-%s", var.aws_project, local.app_id)
  force_destroy = true

  tags = local.app_tags
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket                  = aws_s3_bucket.attachments.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# The signed link is the authorisation, so any origin may use one; only PUT (upload) and GET (download).
resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  cors_rule {
    allowed_methods = ["GET", "PUT"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
