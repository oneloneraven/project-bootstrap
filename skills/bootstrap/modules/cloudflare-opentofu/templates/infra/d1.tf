resource "cloudflare_d1_database" "app" {
  account_id            = var.cloudflare_account_id
  name                  = "{{slug}}"
  primary_location_hint = "weur"

  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "d1_database_id" {
  description = "The D1 database's ID, for database_id in wrangler.jsonc."
  value       = cloudflare_d1_database.app.id
}
