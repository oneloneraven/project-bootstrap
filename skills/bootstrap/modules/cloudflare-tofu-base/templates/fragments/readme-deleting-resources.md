## Deleting resources

`infra.yml` refuses a plan that deletes or replaces anything, so a merge that
removes a resource fails its apply and changes nothing. To apply it on
purpose, read the failed run's plan, then run "Infra" by hand on `main` with
`allow_deletes` ticked. It runs in the `infra` environment, so only `main` can
do it. Resources with `prevent_destroy` still refuse: removing that is the
teardown below.