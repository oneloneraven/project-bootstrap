{{fragment_tofu_terraform_block}}

provider "cloudflare" {}

data "cloudflare_zone" "app" {
  filter = {
    name = var.app_zone_name
  }
}
