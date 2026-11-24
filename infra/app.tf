# Application-level secrets and bootstrap values injected into every backend Lambda.

# Secret used to sign JWT access and refresh tokens. Stable for the lifetime of the state,
# so redeploys do not log users out.
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# Generated password for the first admin account when var.app_admin_password is not set.
resource "random_password" "admin" {
  length  = 20
  special = false
}

locals {
  # Bootstrap values consumed by backend/v1/app/config.py.
  app_env_vars = {
    JWT_SECRET     = random_password.jwt_secret.result
    ADMIN_EMAIL    = var.app_admin_email
    ADMIN_PASSWORD = coalesce(var.app_admin_password, random_password.admin.result)

    # Attachments: the bucket, and (locally only) the LocalStack address the browser can reach for signed links.
    ATTACHMENTS_BUCKET = aws_s3_bucket.attachments.bucket
    ATTACHMENTS_REGION = aws_s3_bucket.attachments.region
    S3_PUBLIC_ENDPOINT = data.aws_caller_identity.this.id == "000000000000" ? "http://localhost:4566" : ""

    # Notification emails: only sent when this is set and the admin setting notifications.email_enabled is on.
    NOTIFY_FROM_EMAIL = var.app_notify_from_email
  }
}

# Serves index.html for client-side routes (paths whose last segment has no file extension),
# so deep links such as /projects/7 work. Attached only to the S3 (static site) behavior.
resource "aws_cloudfront_function" "spa_rewrite" {
  count   = data.aws_caller_identity.this.id != "000000000000" ? 1 : 0
  name    = format("%s-spa-rewrite-%s", var.aws_project, local.app_id)
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite SPA routes to /index.html"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var last = request.uri.split('/').pop();
      if (last.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOT
}
