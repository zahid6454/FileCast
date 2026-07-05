#!/bin/bash
# Test all API endpoints against a running server
# Usage: ./test.sh [base_url]
# Default: http://localhost:8080

BASE="${1:-http://localhost:8080}"
PASS=0
FAIL=0
DIR="$(cd "$(dirname "$0")" && pwd)/test-files"

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

echo "Testing against $BASE"
echo ""

# --- Health ---
echo "=== Health ==="
r=$(curl -s "$BASE/api/v1/health")
check "health returns status" '"status"' "$r"
check "gotenberg is up" '"up"' "$r"

# --- DOCX to PDF ---
echo "=== DOCX to PDF ==="
r=$(curl -s -o /tmp/out.pdf -w "%{http_code}" -X POST -F "file=@$DIR/test.docx" "$BASE/api/v1/convert/docx-to-pdf")
check "returns 200" "200" "$r"
check "output is PDF" "%PDF" "$(head -c 5 /tmp/out.pdf)"

# --- XLSX to PDF ---
echo "=== XLSX to PDF ==="
r=$(curl -s -o /tmp/out.pdf -w "%{http_code}" -X POST -F "file=@$DIR/test.xlsx" "$BASE/api/v1/convert/xlsx-to-pdf")
check "returns 200" "200" "$r"
check "output is PDF" "%PDF" "$(head -c 5 /tmp/out.pdf)"

# --- PPTX to PDF ---
echo "=== PPTX to PDF ==="
r=$(curl -s -o /tmp/out.pdf -w "%{http_code}" -X POST -F "file=@$DIR/test.pptx" "$BASE/api/v1/convert/pptx-to-pdf")
check "returns 200" "200" "$r"
check "output is PDF" "%PDF" "$(head -c 5 /tmp/out.pdf)"

# --- HTML to PDF ---
echo "=== HTML to PDF ==="
r=$(curl -s -o /tmp/out.pdf -w "%{http_code}" -X POST -F "file=@$DIR/test.html" "$BASE/api/v1/convert/html-to-pdf")
check "returns 200" "200" "$r"
check "output is PDF" "%PDF" "$(head -c 5 /tmp/out.pdf)"

# --- PDF Compress ---
echo "=== PDF Compress ==="
r=$(curl -s -o /tmp/out.pdf -w "%{http_code}" -X POST -F "file=@$DIR/test.pdf" -F "quality=screen" "$BASE/api/v1/convert/pdf-compress")
check "returns 200" "200" "$r"
check "output is PDF" "%PDF" "$(head -c 5 /tmp/out.pdf)"

# --- PDF to DOCX ---
echo "=== PDF to DOCX ==="
r=$(curl -s -o /tmp/out.docx -w "%{http_code}" -X POST -F "file=@$DIR/test.pdf" "$BASE/api/v1/convert/pdf-to-docx")
check "returns 200" "200" "$r"
check "output is DOCX" "PK" "$(head -c 2 /tmp/out.docx)"

# --- Validation errors ---
echo "=== Validation ==="
r=$(curl -s -X POST -F "file=@$DIR/test.html" "$BASE/api/v1/convert/docx-to-pdf")
check "wrong extension rejected" "wrong_format" "$r"

echo -n "" > /tmp/empty.docx
r=$(curl -s -X POST -F "file=@/tmp/empty.docx" "$BASE/api/v1/convert/docx-to-pdf")
check "empty file rejected" "empty_file" "$r"

echo "not a docx" > /tmp/fake.docx
r=$(curl -s -X POST -F "file=@/tmp/fake.docx" "$BASE/api/v1/convert/docx-to-pdf")
check "bad magic bytes rejected" "invalid_file" "$r"

# --- Metrics after tests ---
echo "=== Metrics ==="
r=$(curl -s "$BASE/api/v1/metrics")
check "metrics has conversions" '"conversions"' "$r"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
