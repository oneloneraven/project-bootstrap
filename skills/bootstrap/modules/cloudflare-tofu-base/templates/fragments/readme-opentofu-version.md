### OpenTofu version

`infra.yml` pins OpenTofu exactly in `tofu_version`. Dependabot doesn't bump
it. To upgrade, take the newest `opentofu/opentofu` release that is more than
72 hours old (not a pre-release), change `tofu_version`, and run the same
version locally.