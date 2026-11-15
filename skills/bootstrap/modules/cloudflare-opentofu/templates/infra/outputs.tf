output "app_dnssec_ds_record" {
  description = "DS record Cloudflare Registrar publishes from the zone's CDS records, for checking."
  value       = cloudflare_zone_dnssec.app.ds
}
