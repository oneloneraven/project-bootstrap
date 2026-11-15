variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Zero Trust organisation, the applications and the widgets."
  type        = string
}

variable "owner_email" {
  description = "The one email every admin application lets in. Supplied by the OWNER_EMAIL Actions secret, never committed."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.owner_email))
    error_message = "owner_email must be a single email address: check the OWNER_EMAIL secret."
  }
}

variable "login_method_id" {
  description = "The ID of the account's Cloudflare login method in Access. Supplied by the ACCESS_LOGIN_METHOD_ID repository variable."
  type        = string
}

variable "apps" {
  description = "One admin Access application per project, keyed by project. Every application gets the same standard settings."
  type = map(object({
    name   = string
    domain = string
  }))
  default = {}
}

variable "widgets" {
  description = "One Turnstile widget per entry, keyed by project."
  type = map(object({
    name    = string
    domains = list(string)
    mode    = optional(string, "managed")
  }))
  default = {}
}
