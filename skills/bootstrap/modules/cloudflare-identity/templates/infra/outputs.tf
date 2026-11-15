output "team_domain" {
  description = "The Zero Trust organisation's team domain, for each project's ACCESS_TEAM_DOMAIN."
  value       = cloudflare_zero_trust_organization.this.auth_domain
}

output "app_aud" {
  description = "Each admin application's audience tag, by project, for the project's ACCESS_AUD."
  value       = { for key, app in cloudflare_zero_trust_access_application.admin : key => app.aud }
}

output "widget_sitekey" {
  description = "Each Turnstile widget's sitekey, by project."
  value       = { for key, widget in cloudflare_turnstile_widget.site : key => widget.sitekey }
}
