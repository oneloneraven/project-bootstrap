Everything provisionable is managed here with
[OpenTofu](https://opentofu.org), the open-source fork of Terraform (same HCL,
providers and state format): DNS, TLS and HSTS, DNSSEC, CAA, security headers,
cache rules and the `www` redirect for `{{zone_name}}`. The Worker itself is
deployed by wrangler from the release workflows. The only things outside
OpenTofu are the state bucket (it must exist before OpenTofu can use it),
Worker runtime secrets and the CI credentials below.