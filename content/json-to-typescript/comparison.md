## Hand-Written vs. Generated TypeScript Interfaces

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Hand-Written</th><th>Generated From JSON</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>Speed</span></td><td data-label="Hand-Written">Slow for large/nested objects</td><td data-label="Generated From JSON">Instant</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Accuracy</span></td><td data-label="Hand-Written">Prone to typos, missed fields</td><td data-label="Generated From JSON">Matches the actual sample exactly</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Nested objects</span></td><td data-label="Hand-Written">Requires manually naming each one</td><td data-label="Generated From JSON">Automatically named and split out</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Hand-Written">Types that need business logic beyond raw shape (unions, optional fields you know about but the sample doesn't show)</td><td data-label="Generated From JSON">A fast starting point from a real example</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></span>
      <h3>Write Interfaces by Hand When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need fields marked optional (<code>?:</code>) that don't appear in every response</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want precise union types (<code>"admin" | "user"</code>) instead of a plain <code>string</code></li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The type needs to encode business rules the JSON sample alone can't show</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Generate From JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You have a real example response and want a fast, accurate starting point</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're prototyping and just need something usable now, refinable later</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're documenting an API's actual shape rather than its idealized one</li>
    </ul>
  </div>
</div>
