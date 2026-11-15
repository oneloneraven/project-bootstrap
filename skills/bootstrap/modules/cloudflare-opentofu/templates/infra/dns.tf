resource "cloudflare_dns_record" "app_apex" {
  zone_id = data.cloudflare_zone.app.id
  name    = var.app_zone_name
  type    = "A"
  content = "192.0.2.1"
  ttl     = 1
  proxied = true
  comment = "Placeholder so the Worker route answers on this hostname; traffic never reaches this IP."

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "app_www" {
  zone_id = data.cloudflare_zone.app.id
  name    = "www.${var.app_zone_name}"
  type    = "CNAME"
  content = var.app_zone_name
  ttl     = 1
  proxied = true
  comment = "Proxied so the www redirect rule answers; requests never reach an origin."

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  cloudflare_cas = ["letsencrypt.org", "pki.goog", "ssl.com", "sectigo.com"]
  caa_records = merge(
    { for ca in local.cloudflare_cas : "issue-${ca}" => { tag = "issue", value = ca } },
    { for ca in local.cloudflare_cas : "issuewild-${ca}" => { tag = "issuewild", value = ca } },
  )
}

resource "cloudflare_dns_record" "app_caa" {
  for_each = local.caa_records
  zone_id  = data.cloudflare_zone.app.id
  name     = var.app_zone_name
  type     = "CAA"
  ttl      = 3600
  data = {
    flags = 0
    tag   = each.value.tag
    value = each.value.value
  }
}
