## Common Scenarios for Validating YAML

### Debugging a Failed CI/CD Pipeline

GitHub Actions, GitLab CI, and CircleCI all use YAML, and a misaligned step or a duplicated job key can fail a pipeline with an error that doesn't clearly point at the actual line. Validating the file directly narrows it down immediately.

### Checking a Kubernetes Manifest Before Applying It

A tab character copy-pasted from an editor with tab-based indentation is one of the most common reasons `kubectl apply` rejects a manifest. Validating first catches it before you're debugging a cluster-side error.

### Reviewing a Docker Compose File

Service definitions are easy to misindent when adding a new service by copy-pasting an existing one. Validating catches an accidentally-duplicated key or a service block that's drifted one space out of alignment with its siblings.

### Auditing an Ansible Playbook

Playbooks are deeply nested YAML, which makes indentation mistakes easy to introduce and hard to spot. Validating a playbook before a run catches structural issues before they cause a confusing mid-run failure.

### Confirming a Config File Before Committing

Before committing a hand-edited YAML config, validating it catches the class of mistake that's invisible on screen — inconsistent indentation, a stray tab, a repeated key — the same way a linter catches issues a compiler wouldn't. If you're also assembling the release notes for the same deploy, our [PPTX to PDF converter](/convert/pptx-to-pdf/) is handy for turning a slide deck summary into a shareable PDF.
