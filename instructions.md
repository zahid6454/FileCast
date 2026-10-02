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

## 2. Turn on the AdSense loader (before requesting an AdSense review)

**When**: Once, after this change ships, and before clicking Resubmit/Request
review in AdSense. Slot ids are NOT needed for this step.

**What is this for?**
Putting Google's AdSense script on every page. Google's site review looks for
it, and the consent message configured under AdSense → Privacy & messaging is
delivered by it — without the script, EEA/UK visitors never see that message.

**What will this do?**
The next production build adds the `adsbygoogle.js` tag to every page and
opens the CSP to Google's ad hosts. No ad units render until slot ids are
saved (and Auto ads stays off unless you turn it on in the AdSense dashboard),
so the site looks the same.

**Steps**
1. Admin panel → Settings → AdSense: confirm the publisher id is
   `ca-pub-9273443375615163`, tick **Enable AdSense**, leave both slot ids
   blank, save.
2. Trigger/wait for the next production build so the change is baked in.
3. Check: `curl -s https://filecast.org/ | grep adsbygoogle.js` prints the tag.

**Follow-ups**
- After approval: add the real slot ids in the same Settings tab, then visit a
  tool page from an EEA/UK vantage point (VPN) with DevTools open and confirm
  Google's consent message renders with zero CSP violations
  (`scratch-pad/measure_adsense_csp.js` automates the check). Add any missing
  host to `generate_headers()` one at a time.

---
