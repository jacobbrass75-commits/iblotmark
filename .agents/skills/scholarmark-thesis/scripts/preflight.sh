#!/usr/bin/env bash
set -euo pipefail

SM="${SM:-http://89.167.10.34:5001}"
PID="${PID:-cf547e4d-712b-42a1-a33d-6cb67e68e670}"

tmp_root="$(mktemp)"
tmp_projects="$(mktemp)"
tmp_project="$(mktemp)"
tmp_search="$(mktemp)"
tmp_create_project="$(mktemp)"
tmp_upload="$(mktemp)"
tmp_upload_group="$(mktemp)"
tmp_prompt_create="$(mktemp)"
tmp_prompt_list="$(mktemp)"
tmp_analyze_probe="$(mktemp)"

cleanup() {
  rm -f \
    "$tmp_root" \
    "$tmp_projects" \
    "$tmp_project" \
    "$tmp_search" \
    "$tmp_create_project" \
    "$tmp_upload" \
    "$tmp_upload_group" \
    "$tmp_prompt_create" \
    "$tmp_prompt_list" \
    "$tmp_analyze_probe"
}
trap cleanup EXIT

check_status() {
  local label="$1"
  local url="$2"
  local out_file="$3"
  local code
  code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
    -o "$out_file" -w "%{http_code}" "$url")"
  if [[ "$code" != "200" ]]; then
    echo "FAIL ${label}: HTTP ${code} (${url})"
    return 1
  fi
  echo "OK   ${label}: HTTP ${code}"
}

check_status "root" "$SM/" "$tmp_root"
check_status "projects" "$SM/api/projects" "$tmp_projects"
check_status "project" "$SM/api/projects/$PID" "$tmp_project"

search_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/projects/$PID/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"brainwashing Korean War","limit":3}' \
  -o "$tmp_search" -w "%{http_code}")"
if [[ "$search_code" != "200" ]]; then
  echo "FAIL project-search: HTTP ${search_code}"
  exit 1
fi

python3 - "$tmp_search" <<'PY'
import json
import sys
path = sys.argv[1]
obj = json.load(open(path, "r", encoding="utf-8"))
required = {"results", "totalResults", "searchTime"}
missing = sorted(list(required - set(obj.keys())))
if missing:
    print(f"FAIL project-search: missing keys {missing}")
    sys.exit(1)
print(f"OK   project-search: totalResults={obj.get('totalResults')}")
PY

create_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"preflight-temp-project","description":"temporary preflight probe"}' \
  -o "$tmp_create_project" -w "%{http_code}")"
if [[ "$create_code" != "201" ]]; then
  echo "FAIL project-create: HTTP ${create_code}"
  exit 1
fi
temp_project_id="$(python3 - "$tmp_create_project" <<'PY'
import json, sys
obj = json.load(open(sys.argv[1], "r", encoding="utf-8"))
print(obj.get("id", ""))
PY
)"
if [[ -z "$temp_project_id" ]]; then
  echo "FAIL project-create: missing id"
  exit 1
fi
echo "OK   project-create: HTTP 201 (id=${temp_project_id})"

delete_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X DELETE "$SM/api/projects/$temp_project_id" -o /dev/null -w "%{http_code}")"
if [[ "$delete_code" != "204" ]]; then
  echo "FAIL project-delete: HTTP ${delete_code}"
  exit 1
fi
echo "OK   project-delete: HTTP 204"

upload_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/upload" -o "$tmp_upload" -w "%{http_code}")"
if [[ "$upload_code" != "400" ]]; then
  echo "FAIL upload-endpoint: expected HTTP 400 for empty upload probe, got ${upload_code}"
  exit 1
fi
echo "OK   upload-endpoint: HTTP 400 on empty upload probe"

upload_group_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/upload-group" -o "$tmp_upload_group" -w "%{http_code}")"
if [[ "$upload_group_code" != "400" ]]; then
  echo "FAIL upload-group-endpoint: expected HTTP 400 for empty group upload probe, got ${upload_group_code}"
  exit 1
fi
echo "OK   upload-group-endpoint: HTTP 400 on empty group upload probe"

prompt_create_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/projects/$PID/prompt-templates" \
  -H "Content-Type: application/json" \
  -d '{"name":"preflight-temp-template","prompts":[{"text":"preflight probe","color":"#60a5fa"}]}' \
  -o "$tmp_prompt_create" -w "%{http_code}")"
if [[ "$prompt_create_code" != "201" ]]; then
  echo "FAIL prompt-template-create: HTTP ${prompt_create_code}"
  exit 1
fi

temp_template_id="$(python3 - "$tmp_prompt_create" <<'PY'
import json, sys
obj = json.load(open(sys.argv[1], "r", encoding="utf-8"))
print(obj.get("id", ""))
PY
)"
if [[ -z "$temp_template_id" ]]; then
  echo "FAIL prompt-template-create: missing id"
  exit 1
fi
echo "OK   prompt-template-create: HTTP 201 (id=${temp_template_id})"

prompt_list_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  "$SM/api/projects/$PID/prompt-templates" -o "$tmp_prompt_list" -w "%{http_code}")"
if [[ "$prompt_list_code" != "200" ]]; then
  echo "FAIL prompt-template-list: HTTP ${prompt_list_code}"
  exit 1
fi
echo "OK   prompt-template-list: HTTP 200"

prompt_delete_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X DELETE "$SM/api/prompt-templates/$temp_template_id" -o /dev/null -w "%{http_code}")"
if [[ "$prompt_delete_code" != "204" ]]; then
  echo "FAIL prompt-template-delete: HTTP ${prompt_delete_code}"
  exit 1
fi
echo "OK   prompt-template-delete: HTTP 204"

first_project_doc_id="$(python3 - "$SM" "$PID" <<'PY'
import json
import urllib.request
import urllib.error
import sys

sm = sys.argv[1].rstrip("/")
pid = sys.argv[2]
url = f"{sm}/api/projects/{pid}/documents"
try:
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, list) and data:
            print(data[0].get("id", ""))
        else:
            print("")
except Exception:
    print("")
PY
)"
if [[ -n "$first_project_doc_id" ]]; then
  analyze_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
    -X POST "$SM/api/project-documents/$first_project_doc_id/analyze-multi" \
    -H "Content-Type: application/json" \
    -d '{"prompts":[]}' -o "$tmp_analyze_probe" -w "%{http_code}")"
  if [[ "$analyze_code" != "400" ]]; then
    echo "FAIL analyze-multi-probe: expected HTTP 400 on empty prompts, got ${analyze_code}"
    exit 1
  fi
  echo "OK   analyze-multi-probe: HTTP 400 on empty prompts validation probe"
else
  echo "WARN analyze-multi-probe: skipped (no project documents found)"
fi

echo "PASS ScholarMark preflight complete"
