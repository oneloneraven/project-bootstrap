Run "Bootstrap OpenTofu state bucket".
Run "Infra" to recreate everything managed here.
Remove `prevent_destroy` from every resource in a PR (the infra workflow refuses plans that delete, so run the destroy locally).
Locally, with the infra apply token and state credentials in your environment: `tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"` then `tofu destroy`.
Empty and delete the `{{slug}}-tfstate` bucket in the dashboard.
