## Binary vs. Decimal vs. Hex vs. Octal

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col><col><col></colgroup>
<thead><tr><th>Base</th><th>Radix</th><th>Digits Used</th><th>Example (255)</th><th>Common Use</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Binary</span></td><td data-label="Radix">2</td><td data-label="Digits Used">0-1</td><td data-label="Example (255)"><code>11111111</code></td><td data-label="Common Use">What hardware actually stores</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Octal</span></td><td data-label="Radix">8</td><td data-label="Digits Used">0-7</td><td data-label="Example (255)"><code>377</code></td><td data-label="Common Use">Unix file permissions (<code>chmod</code>)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Decimal</span></td><td data-label="Radix">10</td><td data-label="Digits Used">0-9</td><td data-label="Example (255)"><code>255</code></td><td data-label="Common Use">Everyday human arithmetic</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Hexadecimal</span></td><td data-label="Radix">16</td><td data-label="Digits Used">0-9, A-F</td><td data-label="Example (255)"><code>FF</code></td><td data-label="Common Use">Color codes, memory addresses, byte values</td></tr>
</tbody>
</table>
</div>

### Use Binary When

- You're working directly with bitwise operations, flags, or hardware registers
- You need to see exactly which individual bits are set

### Use Hex When

- You're reading a color code, a memory address, or a byte dump
- You want a compact, copy-pasteable stand-in for binary (4 bits per hex digit)

### Use Octal When

- You're setting Unix/Linux file permissions
- You're reading legacy code or protocols that still use octal literals

### Use Decimal When

- You're communicating a value to a person, not a machine
