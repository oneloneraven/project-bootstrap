Everything provisionable is managed here with
[OpenTofu](https://opentofu.org), the open-source fork of Terraform (same HCL,
providers and state format): this project's own DNS records in
`{{zone_name}}`. The zone and its zone-wide settings and rules belong to the
stack that manages it. The Worker itself is deployed by wrangler from the
release workflows. The only things outside OpenTofu are the state bucket (it
must exist before OpenTofu can use it), Worker runtime secrets and the CI
credentials below.