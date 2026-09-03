## Common Scenarios for JSON to YAML Conversion

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Setting Up Docker Compose Files

Docker Compose uses YAML for service definitions. If you have service configurations in JSON from an API or a generator, converting them to YAML produces a docker-compose.yml file that is ready to use.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></div>
<div class="scenario__body" markdown="1">

### Writing Kubernetes Manifests

Kubernetes accepts both JSON and YAML, but the community and documentation overwhelmingly use YAML. Converting JSON resource definitions to YAML makes them consistent with examples, tutorials, and team conventions.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></div>
<div class="scenario__body" markdown="1">

### Configuring CI/CD Pipelines

GitHub Actions, GitLab CI, CircleCI, and most CI/CD platforms use YAML for pipeline configuration. When migrating settings from a JSON-based system or generating configs programmatically, converting to YAML produces the expected format.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-file-plus"></use></svg></div>
<div class="scenario__body" markdown="1">

### Creating Ansible Playbooks

Ansible uses YAML for playbooks and inventory files. If you export host data or task definitions as JSON, converting them to YAML makes them compatible with Ansible's expected input format.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg></div>
<div class="scenario__body" markdown="1">

### Simplifying Configuration for Team Editing

JSON configuration files can be hard to edit by hand — missing commas and mismatched brackets cause silent failures. Converting to YAML gives your team a format that is easier to read, edit, and review in pull requests.

</div>
</div>
</div>
