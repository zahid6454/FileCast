## Binary vs. Decimal vs. Hex vs. Octal

| Base | Radix | Digits Used | Example (255) | Common Use |
|---|---|---|---|---|
| Binary | 2 | 0-1 | `11111111` | What hardware actually stores |
| Octal | 8 | 0-7 | `377` | Unix file permissions (`chmod`) |
| Decimal | 10 | 0-9 | `255` | Everyday human arithmetic |
| Hexadecimal | 16 | 0-9, A-F | `FF` | Color codes, memory addresses, byte values |

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
