# FileCast — Manual Operations

This file catalogs every manual, human-run task in FileCast — anything that
isn't automated by CI/CD. Each entry follows the same core format (When /
What is this for / What will this do / Steps / Follow-ups), with two
optional sections (Before you start / If something goes wrong) added only
for tasks that are risky, irreversible, or need real prep. Entries are
numbered in the order they were added — the number is just a unique marker
to spot where each entry starts, not a required order to follow them in.

---

## 1. SSH into the Oracle VM

**When**: Whenever you need shell access to the production server — a
prerequisite for most other manual tasks in this file, not something with
a trigger of its own.

**What is this for?**
Getting an interactive shell on the production backend VM (`filecast-api`,
Oracle Cloud, `VM.Standard.A1.Flex`, region us-ashburn-1) so you can run
commands directly — Docker Compose, log inspection, one-off scripts like
Bootstrap (entry 2).

**What will this do?**
Opens a normal SSH session. Doesn't change anything on the server by
itself.

**Steps**
```
ssh -i ~/.ssh/filecast_oracle ubuntu@129.80.133.134
```

**Follow-ups**
- You're now in a shell on the VM — proceed with whatever task brought you
  here.

**If something goes wrong**
- Connection refused / times out: check the instance is actually running
  in the Oracle Cloud console (Compute → Instances → `filecast-api`).
- Permission denied: confirm `~/.ssh/filecast_oracle` exists locally and
  has restrictive permissions (`chmod 600` on Linux/Mac; on Windows,
  make sure it isn't world-readable). If you're on a new machine, restore
  this key from your backup/password manager rather than generating a new
  one — a new key won't match what's in the VM's `authorized_keys`.
- If you're not sure this key gives full shell access (versus being
  restricted to a single command), run something harmless first, e.g.
  `ssh -i ~/.ssh/filecast_oracle ubuntu@129.80.133.134 whoami` — if it
  prints `ubuntu`, you have a normal shell.

---
