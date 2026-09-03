## Password Protection vs Other Ways to Restrict a PDF

There's more than one way to keep a PDF's contents from spreading further than intended. Here's how a password requirement compares to the alternatives.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col><col></colgroup>
<thead><tr><th>Consideration</th><th>Password Protection</th><th>Watermarking</th><th>Sharing Link Controls</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-no-lock"></use></svg>Blocks opening the file at all</span></td><td data-label="Password Protection">Yes</td><td data-label="Watermarking">No</td><td data-label="Sharing Link Controls">Depends on the platform</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-download"></use></svg>Works once the file is downloaded</span></td><td data-label="Password Protection">Yes</td><td data-label="Watermarking">Yes</td><td data-label="Sharing Link Controls">No — controls stop once downloaded</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Requires the recipient to do anything</span></td><td data-label="Password Protection">Enter a password</td><td data-label="Watermarking">Nothing</td><td data-label="Sharing Link Controls">Sign in, if required</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Deters casual redistribution</span></td><td data-label="Password Protection">Yes</td><td data-label="Watermarking">Yes, visibly</td><td data-label="Sharing Link Controls">No</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Setup needed</span></td><td data-label="Password Protection">None — just this tool</td><td data-label="Watermarking">None — just this tool</td><td data-label="Sharing Link Controls">Depends on the sharing platform</td></tr>
</tbody>
</table>
</div>

"Blocks opening the file at all" means no reader will display the content without the password — it doesn't mean the password can't eventually be recovered by someone running dedicated cracking software against it. See "How Strong Is This Protection?" on this tool's page for what that means in practice.

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
      <h3>Use Password Protection When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The file must not be casually openable, wherever it ends up</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're sending it somewhere you don't fully control, like email or a personal drive</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>"Don't open unless you're supposed to" needs to be enforced by the file itself, not just asked for</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want protection that travels with the file itself, not tied to a link or platform</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg></span>
      <h3>Consider a Different Approach When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the content visible but marked as a draft or confidential — watermarking fits better</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to revoke access after sharing — a password can't be taken back once someone has it, so a sharing-link platform with revocable access suits that case better</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The recipient needs to edit the file collaboratively — a shared, permission-controlled document works better than a password-locked static PDF</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The document has a real regulatory or compliance requirement behind it — confirm what encryption standard is actually required rather than assuming this covers it</li>
    </ul>
  </div>
</div>
