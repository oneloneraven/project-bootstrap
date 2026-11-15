import {
  to = cloudflare_zero_trust_organization.this
  id = var.cloudflare_account_id
}

resource "cloudflare_zero_trust_organization" "this" {
  account_id                 = var.cloudflare_account_id
  is_ui_read_only            = true
  ui_read_only_toggle_reason = "Managed in code: change it through a pull request to this repository."

  service_token_inactivity = {
    enabled                   = false
    inactivity_threshold_days = 90
    action                    = "disable"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      auth_domain,
      custom_pages,
      deny_unmatched_requests,
      deny_unmatched_requests_exempted_zone_names,
      login_design,
      mfa_config,
      mfa_piv_key_requirements,
      name,
      session_duration,
      user_seat_expiration_inactive_time,
      warp_auth_session_duration,
    ]
  }
}

import {
  to = cloudflare_zero_trust_access_identity_provider.login
  id = "accounts/${var.cloudflare_account_id}/${var.login_method_id}"
}

resource "cloudflare_zero_trust_access_identity_provider" "login" {
  account_id = var.cloudflare_account_id
  name       = "Cloudflare"
  type       = "cloudflare"

  config = {
    restrict_to_account_members = true
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [name]
  }
}

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id = var.cloudflare_account_id
  name       = "Allow the owner"
  decision   = "allow"

  include = [{
    email = {
      email = var.owner_email
    }
  }]
}
