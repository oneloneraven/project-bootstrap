resource "cloudflare_turnstile_widget" "site" {
  for_each = var.widgets

  account_id = var.cloudflare_account_id
  name       = each.value.name
  domains    = sort(each.value.domains)
  mode       = each.value.mode

  lifecycle {
    prevent_destroy = true
  }
}
